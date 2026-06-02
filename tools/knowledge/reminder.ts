/**
 * F1.6 — Lembretes proativos (revisão espaçada).
 *
 * Roda 1x/dia (agendado pelo `genie schedule`). Varre artigos salvos que o usuário
 * NUNCA leu (não recuperou via send_summary) e que estão parados há ≥ N dias, e
 * manda UM cutucão por chat (o mais antigo elegível) — só título + link, sem o card
 * (anti-poluição; o usuário pede o resumo com "me manda o resumo de X").
 *
 * Regras (defaults, overrideáveis por env p/ teste):
 *   - LINKMIND_REMINDER_DIAS (3): idade mínima e intervalo entre lembretes do mesmo node.
 *   - LINKMIND_REMINDER_MAX  (3): teto de lembretes por node — depois desiste.
 *
 * Estado fica no próprio knowledge_node (reminder_count, last_reminder_at,
 * last_recalled_at) — sem fila externa.
 *
 * Uso: `bun run reminder.ts`  (ou agendado: `genie schedule create ...`).
 */
import { withDb } from "./db.ts";
import { sendWhatsApp } from "./notify.ts";

/** Lê os limites do env em tempo de chamada (default 3) — permite override por teste. */
function getLimits(): { minDays: number; maxReminders: number } {
  return {
    minDays: Number(process.env.LINKMIND_REMINDER_DIAS ?? "3"),
    maxReminders: Number(process.env.LINKMIND_REMINDER_MAX ?? "3"),
  };
}

export type Pendente = {
  id: string;
  chat: string;
  url: string;
  title: string | null;
  topico: string;
  idade_dias: number;
};

/** 1 node por chat (o mais antigo elegível): não lido, parado há ≥DIAS, abaixo do teto. */
export async function buscarPendentes(): Promise<Pendente[]> {
  const { minDays, maxReminders } = getLimits();
  return withDb(async (db) => {
    const rows = await db`
      SELECT DISTINCT ON (chat)
        id, chat, url, title, topico,
        EXTRACT(DAY FROM now() - created_at)::int AS idade_dias
      FROM knowledge_node
      WHERE chat IS NOT NULL
        AND status = 'RELEASED'                  -- F1.7: pendente de pesquisa não vira nudge
        AND last_recalled_at IS NULL
        AND reminder_count < ${maxReminders}
        AND created_at < now() - make_interval(days => ${minDays})
        AND (last_reminder_at IS NULL
             OR last_reminder_at < now() - make_interval(days => ${minDays}))
      ORDER BY chat, created_at ASC`;
    return rows.map((r: any) => ({
      id: String(r.id),
      chat: String(r.chat),
      url: String(r.url),
      title: r.title,
      topico: String(r.topico),
      idade_dias: Number(r.idade_dias),
    }));
  });
}

export function formatNudge(p: Pendente): string {
  const name = p.title ?? p.topico;
  return [
    `📚 Você salvou *${name}* há ${p.idade_dias} dias e ainda não leu.`,
    `🔗 ${p.url}`,
    `Quer o resumo? manda "me manda o resumo de ${p.topico}"`,
  ].join("\n");
}

export async function marcarLembrado(id: string): Promise<void> {
  await withDb((db) => db`
    UPDATE knowledge_node
    SET reminder_count = reminder_count + 1, last_reminder_at = now()
    WHERE id = ${id}`);
}

async function main(): Promise<void> {
  const { minDays, maxReminders } = getLimits();
  const pendentes = await buscarPendentes();
  console.error(`[reminder] ${pendentes.length} chat(s) com artigo parado (DIAS=${minDays}, MAX=${maxReminders})`);
  for (const p of pendentes) {
    const ok = await sendWhatsApp(p.chat, formatNudge(p));
    // Só conta o lembrete se o envio deu certo — senão tenta de novo amanhã.
    if (ok) {
      await marcarLembrado(p.id);
      console.error(`[reminder] cutucado: ${p.topico} → ${p.chat}`);
    } else {
      console.error(`[reminder] FALHOU envio: ${p.topico} → ${p.chat} (não marca; retenta)`);
    }
  }
}

// --- script: `bun run reminder.ts` (ou agendado). Importar o módulo NÃO dispara
// o main (nem toca o DB / WhatsApp) — só a execução direta como CLI. ---
if (import.meta.main) {
  const startedAt = new Date().toISOString();
  console.error(`[reminder] start ${startedAt}`);
  main()
    .then(() => console.error(`[reminder] done`))
    .catch((e) => {
      console.error(`[reminder] CRASH: ${(e as Error).stack ?? e}`);
      process.exit(1);
    });
}
