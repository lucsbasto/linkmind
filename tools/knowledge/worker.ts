/**
 * F1.4 / P2 — Worker de arquivamento (roda DESACOPLADO do turno do agente).
 *
 * Disparado por `archive_link` via `setsid bun run worker.ts <url>`. Faz o trabalho
 * lento (captura → resumo Gemini → persiste) e, ao terminar, manda o card pro
 * WhatsApp via `omni send`. Em erro de qualquer etapa, manda um aviso curto.
 *
 * Callback MVP (single-user): instância + número fixos por env (default = a conta
 * do Lucas). Multi-usuário (chat dinâmico) fica pra depois.
 */
import { extractArticle } from "./extract.ts";
import { summarizeFeynman, type FeynmanCard } from "./summarize.ts";
import { openDb } from "./db.ts";

const OMNI_INSTANCE = process.env.LINKMIND_OMNI_INSTANCE ?? "05415247-c598-4a2b-832b-f127d4410e10";
const OMNI_TO = process.env.LINKMIND_OMNI_TO ?? "+556392747980";

async function sendWhatsApp(text: string): Promise<void> {
  const proc = Bun.spawn(
    ["omni", "send", "--instance", OMNI_INSTANCE, "--to", OMNI_TO, "--text", text],
    { stdout: "ignore", stderr: "ignore" },
  );
  const code = await proc.exited;
  if (code !== 0) console.error(`[worker] omni send saiu com código ${code}`);
}

function formatCard(card: FeynmanCard, title: string | undefined, url: string): string {
  const pilares = card.pilares.map((p) => `• ${p}`).join("\n");
  return [
    `🧠 *${title ?? card.topico}*`,
    ``,
    `💡 ${card.ideia_central}`,
    ``,
    `📌 *Pilares:*`,
    pilares,
    ``,
    `🔧 *Aplicação:* ${card.aplicacao}`,
    ``,
    `🏷️ ${card.topico}  ·  salvo ✅`,
    `🔗 ${url}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("[worker] uso: bun run worker.ts <url>");
    process.exit(2);
  }

  // 1. Captura
  const captured = await extractArticle(url);
  if (!captured.ok || !captured.text) {
    await sendWhatsApp(`⚠️ Não consegui abrir esse link pra resumir (${captured.error}).\n🔗 ${url}`);
    return;
  }

  // 2. Resumo (Gemini)
  const summary = await summarizeFeynman(captured.text);
  if (!summary.ok) {
    await sendWhatsApp(`⚠️ Abri o link mas não consegui resumir (${summary.error}).\n🔗 ${url}`);
    return;
  }
  const card = summary.card;

  // 3. Persiste
  const db = openDb();
  try {
    const summaryText = `${card.ideia_central}\n${card.pilares.join("\n")}\n${card.aplicacao}`;
    await db`
      INSERT INTO knowledge_node (url, title, topico, card, summary_text)
      VALUES (${captured.url}, ${captured.title ?? null}, ${card.topico},
              ${JSON.stringify(card)}::jsonb, ${summaryText})`;
  } catch (e) {
    await sendWhatsApp(`⚠️ Resumi, mas falhei ao salvar (${(e as Error).message}).\n🔗 ${url}`);
    return;
  } finally {
    await db.end();
  }

  // 4. Callback: manda o card
  await sendWhatsApp(formatCard(card, captured.title, captured.url));
}

await main();
