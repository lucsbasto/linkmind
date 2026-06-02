/**
 * F1.6 / P1 — Worker de PESQUISA web (roda DESACOPLADO do turno do agente).
 *
 * Disparado por `search_web_knowledge` via `setsid bun run search-worker.ts <query> <chat>`.
 * Faz o trabalho lento (Gemini com grounding: pesquisa web + síntese Feynman num passo)
 * e, em vez de mandar o card cheio, RETÉM o resultado como pendente (F1.7 / `enqueuePending`):
 * grava `PENDING_RELEASE` e dispara só a pílula curta. O usuário pega o texto denso depois,
 * com o gatilho "pode mandar" (release_pending). Esse é o anti-textão — a pesquisa PRODUZ
 * o pendente; quem libera é o release.
 */
import { researchWeb } from "./search.ts";
import { enqueuePending } from "./release.ts";
import { sendWhatsApp } from "./notify.ts";

async function main(): Promise<void> {
  const query = (process.argv[2] ?? "").trim();
  const chat = (process.argv[3] ?? "").trim();
  if (!query) {
    console.error("[search-worker] ABORT: query vazia (argv[2])");
    process.exit(2);
  }
  if (!chat) {
    // Sem destino não há pra onde mandar a pílula — aborta cedo (não gasta Gemini).
    console.error("[search-worker] ABORT: chat de destino vazio (argv[3])");
    process.exit(2);
  }

  // 1. Pesquisa + síntese num passo só (Gemini grounding).
  const res = await researchWeb(query);
  if (!res.ok) {
    console.error(`[search-worker] pesquisa falhou: ${res.error}`);
    await sendWhatsApp(chat, `😕 pesquisei sobre *${query}* mas não consegui montar o resumo agora.`);
    return;
  }
  const { card, sources } = res;
  console.error(`[search-worker] ok — tópico "${card.topico}", ${sources.length} fonte(s)`);

  // 2. RETÉM como pendente (anti-textão): grava PENDING_RELEASE e dispara só a pílula
  // curta. O texto denso sai depois, com "pode mandar" (release_pending). NÃO mandamos
  // o card cheio aqui. Guardamos as fontes junto no jsonb (não se perdem) e usamos a
  // primeira como o link visível na liberação.
  const { id } = await enqueuePending(
    chat,
    { ...card, fontes: sources },
    {
      type: "RESEARCH",
      topico: card.topico || query,
      title: query,
      url: sources[0]?.url, // link visível no card liberado (default 'pending://research' se vazio)
    },
  );
  console.error(`[search-worker] pendente ${id} gravado (PENDING_RELEASE) para ${chat}`);
}

// Roda detached: qualquer throw precisa ir pro log (não some no /dev/null).
const startedAt = new Date().toISOString();
console.error(`[search-worker] start ${startedAt} query=${process.argv[2]}`);
main()
  .then(() => console.error(`[search-worker] done ${process.argv[2]}`))
  .catch((e) => {
    console.error(`[search-worker] CRASH: ${(e as Error).stack ?? e}`);
    process.exit(1);
  });
