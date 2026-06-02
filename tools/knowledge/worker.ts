/**
 * F1.4 / P2 — Worker de arquivamento (roda DESACOPLADO do turno do agente).
 *
 * Disparado por `archive_link` via `setsid bun run worker.ts <url> <chat>`. Faz o
 * trabalho lento (captura → resumo Gemini → persiste) e, ao terminar, manda o card
 * pro WhatsApp via `omni send`. Em erro de qualquer etapa, manda um aviso curto.
 *
 * MULTI-USUÁRIO: o destino (`<chat>` = argv[3]) vem do contexto do turno — cada
 * número que escreve é um chat diferente e o card volta pra ele. ATENÇÃO: o destino
 * é o JID do CHAT (`...@lid`), NÃO o número da instância — `--to <numero-da-instancia>`
 * cai num chat errado (o card não chega na conversa de quem mandou o link).
 */
import { extractArticle } from "./extract.ts";
import { summarizeFeynman, type FeynmanCard } from "./summarize.ts";
import { openDb } from "./db.ts";

const OMNI_INSTANCE = process.env.LINKMIND_OMNI_INSTANCE ?? "05415247-c598-4a2b-832b-f127d4410e10";
// Destino = chat de quem mandou o link (argv[3]); env só como override de teste.
const OMNI_TO = process.argv[3] ?? process.env.LINKMIND_OMNI_TO ?? "";

// O worker roda detached sob o bridge, cujo PATH pode não incluir ~/.bun/bin →
// `omni` não resolveria. Resolvemos o binário de forma robusta: env > PATH (Bun.which)
// > caminho absoluto conhecido > nome puro (último recurso).
const OMNI_BIN =
  process.env.LINKMIND_OMNI_BIN ??
  Bun.which("omni") ??
  `${process.env.HOME ?? "/home/lucsb"}/.bun/bin/omni`;

async function sendWhatsApp(text: string): Promise<void> {
  const proc = Bun.spawn(
    [OMNI_BIN, "send", "--instance", OMNI_INSTANCE, "--to", OMNI_TO, "--text", text],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    console.error(`[worker] omni send FALHOU (código ${code}) bin=${OMNI_BIN}`);
    console.error(`[worker] stdout: ${out.trim()}`);
    console.error(`[worker] stderr: ${err.trim()}`);
  } else {
    console.error(`[worker] omni send OK → ${OMNI_TO}`);
  }
}

// Confirmação curta enviada ao terminar o arquivamento — NÃO o card cheio (pra não
// poluir o chat). O card completo fica salvo no banco e é reenviado só sob demanda
// (ver formatCard / recuperação).
function formatConfirmation(card: FeynmanCard, title: string | undefined): string {
  return [
    `🧠 *${title ?? card.topico}*`,
    `salvo ✅ — manda "me manda o resumo" se quiser o card completo`,
  ].join("\n");
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
    console.error("[worker] uso: bun run worker.ts <url> <chat>");
    process.exit(2);
  }
  if (!OMNI_TO) {
    // Sem destino não há pra onde mandar o card — aborta cedo (não desperdiça
    // captura/Gemini/escrita) e deixa rastro no log.
    console.error("[worker] ABORT: chat de destino vazio (argv[3]/LINKMIND_OMNI_TO)");
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

  // 4. Callback: manda só a confirmação curta (card cheio fica salvo p/ envio sob demanda)
  await sendWhatsApp(formatConfirmation(card, captured.title));
}

// Roda detached: qualquer throw precisa ir pro log (não some no /dev/null).
const startedAt = new Date().toISOString();
console.error(`[worker] start ${startedAt} url=${process.argv[2]}`);
main()
  .then(() => console.error(`[worker] done ${process.argv[2]}`))
  .catch((e) => {
    console.error(`[worker] CRASH: ${(e as Error).stack ?? e}`);
    process.exit(1);
  });
