/**
 * F1.7 — Gatilho async anti-textão (release sob comando).
 *
 * Conteúdo denso (resultado de pesquisa F1.6, ou cards longos) fica RETIDO com
 * status `PENDING_RELEASE`; o usuário recebe só uma pílula curta. Quando ele manda
 * o gatilho ("pode mandar", "manda", ...), o texto retido é entregue — exatamente
 * uma vez, com segurança sob concorrência via `FOR UPDATE SKIP LOCKED`.
 *
 * O ponto técnico do diferencial (PRD: "zero duplicação"): dois turnos podem
 * disparar o release ao mesmo tempo (usuário manda "manda" 2×, ou retry do bridge).
 * O claim atômico `WITH ... FOR UPDATE SKIP LOCKED ... UPDATE ... RETURNING` numa
 * transação garante que cada pendente sai 1× (concorrentes pulam a linha travada).
 * Crash entre commit e envio = no máximo 1 msg perdida, nunca duplicada (at-most-once
 * pós-commit; upgrade p/ outbox anotado na spec).
 *
 * Cada chamada abre sua PRÓPRIA conexão (`openDb()` → pool independente) — é o que
 * faz o SKIP LOCKED valer entre releases concorrentes (transações distintas).
 */
import { openDb } from "./db.ts";
import { sendWhatsApp, formatCard } from "./notify.ts";
import type { FeynmanCard } from "./summarize.ts";

export type PendingType = "RESEARCH" | "LINK" | "YOUTUBE";

export type EnqueueOpts = {
  /** Origem do node retido (default RESEARCH — é quem usa retenção hoje). */
  type?: PendingType;
  url?: string;
  title?: string | null;
  topico?: string | null;
  /** Texto curto da pílula; se omitido, gera um default sem o conteúdo denso. */
  pilula?: string;
};

export type ReleasedRow = {
  id: string;
  card: unknown;
  url: string;
  title: string | null;
  topico: string | null;
};

export type ReleaseResult = { released: ReleasedRow | null; remaining: number };

/** Pílula curta padrão — NUNCA inclui o conteúdo denso (esse é o anti-textão). */
function defaultPilula(opts: EnqueueOpts): string {
  const assunto = opts.topico ?? opts.title ?? "o que você pediu";
  return `🔎 já pesquisei sobre *${assunto}* — manda "pode mandar" que te envio o texto.`;
}

/**
 * Retém conteúdo denso: grava 1 node `PENDING_RELEASE` (type RESEARCH por padrão)
 * e dispara SÓ a pílula curta. Usado pela F1.6 (e por quem mais quiser reter). [RL-07]
 */
export async function enqueuePending(
  chat: string,
  card: unknown,
  opts: EnqueueOpts = {},
): Promise<{ id: string }> {
  if (!chat || !chat.trim()) throw new Error("enqueuePending: chat vazio");
  const type = opts.type ?? "RESEARCH";
  const url = opts.url ?? "pending://research"; // url é NOT NULL no schema; pendente raramente tem URL própria
  const db = openDb();
  let id: string;
  try {
    const rows = await db`
      INSERT INTO knowledge_node (url, title, topico, card, chat, status, type)
      VALUES (${url}, ${opts.title ?? null}, ${opts.topico ?? null},
              ${JSON.stringify(card)}::jsonb, ${chat}, 'PENDING_RELEASE', ${type})
      RETURNING id`;
    id = String((rows[0] as any).id);
  } finally {
    await db.end();
  }
  // best-effort: a pílula é notificação; não derruba o enqueue se o envio falhar.
  await sendWhatsApp(chat, opts.pilula ?? defaultPilula(opts)).catch(() => false);
  return { id };
}

/** Formata o conteúdo liberado. Tolera card Feynman, `{texto}` ou payload arbitrário. */
function formatReleased(r: ReleasedRow, remaining: number): string {
  const card: any = r.card;
  let body: string;
  if (card && typeof card === "object" && "ideia_central" in card && "pilares" in card) {
    body = formatCard(card as FeynmanCard, r.title ?? undefined, r.url);
  } else if (card && typeof card === "object" && "texto" in card) {
    body = String(card.texto);
  } else {
    body = typeof card === "string" ? card : JSON.stringify(card);
  }
  const tail =
    remaining > 0
      ? `\n\n_(ainda tem ${remaining} esperando — manda "pode mandar" pra próxima)_`
      : "";
  return body + tail;
}

/**
 * Libera o pendente MAIS ANTIGO do chat — exatamente uma vez sob concorrência.
 * O claim e a transição PENDING_RELEASE→RELEASED acontecem na MESMA transação
 * (`FOR UPDATE SKIP LOCKED`); concorrentes pulam a linha travada e voltam found:0.
 * Envia o conteúdo DEPOIS do commit (at-most-once). Retorna `{released, remaining}`
 * (released null se não havia pendente). [RL-01..05]
 */
export async function releasePending(chat: string): Promise<ReleaseResult> {
  if (!chat || !chat.trim()) return { released: null, remaining: 0 };
  const db = openDb();
  try {
    const released = await db.begin(async (tx) => {
      const rows = await tx`
        WITH proximo AS (
          SELECT id FROM knowledge_node
          WHERE chat = ${chat} AND status = 'PENDING_RELEASE'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE knowledge_node k
        SET status = 'RELEASED', released_at = now()
        FROM proximo
        WHERE k.id = proximo.id
        RETURNING k.id, k.card, k.url, k.title, k.topico`;
      if (rows.length === 0) return null;
      const r: any = rows[0];
      return {
        id: String(r.id),
        // jsonb volta como string no Bun.sql; tolera também já-objeto.
        card: typeof r.card === "string" ? JSON.parse(r.card) : r.card,
        url: String(r.url),
        title: r.title ?? null,
        topico: r.topico ?? null,
      } as ReleasedRow;
    });

    // Contagem de pendentes restantes (best-effort, fora da transação).
    const rest = await db`
      SELECT count(*)::int AS n FROM knowledge_node
      WHERE chat = ${chat} AND status = 'PENDING_RELEASE'`;
    const remaining = Number((rest[0] as any).n);

    // Envio pós-commit: a linha já está RELEASED → não reenviamos (idempotente do
    // lado do claim). Falha de envio aqui = at-most-once (perda rara tolerada no MVP).
    if (released) {
      await sendWhatsApp(chat, formatReleased(released, remaining)).catch(() => false);
    }
    return { released, remaining };
  } finally {
    await db.end();
  }
}

// --- harness standalone: `bun run release.ts <release|enqueue> <chat> [texto]` ---
if (import.meta.main) {
  const [cmd, chat, ...rest] = process.argv.slice(2);
  if (!cmd || !chat) {
    console.error("uso: bun run release.ts <release|enqueue> <chat> [texto]");
    process.exit(2);
  }
  if (cmd === "enqueue") {
    const texto = rest.join(" ") || "conteúdo de pesquisa de teste";
    const { id } = await enqueuePending(chat, { texto }, { topico: "teste" });
    console.error(`[release] enfileirado ${id} (PENDING_RELEASE) para ${chat}`);
  } else if (cmd === "release") {
    const r = await releasePending(chat);
    console.error(
      r.released
        ? `[release] liberado ${r.released.id}; restam ${r.remaining}`
        : `[release] nada pendente para ${chat}`,
    );
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.error(`comando desconhecido: ${cmd}`);
    process.exit(2);
  }
}
