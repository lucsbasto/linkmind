/**
 * F1.6 / P1 — Worker de PESQUISA web (roda DESACOPLADO do turno do agente).
 *
 * Disparado por `search_web_knowledge` via `setsid bun run search-worker.ts <query> <chat>`.
 * Faz o trabalho lento (Brave Search → abrir top URLs → resumo Gemini) e, em vez de
 * mandar o card cheio, RETÉM o resultado como pendente (F1.7 / `enqueuePending`): grava
 * `PENDING_RELEASE` e dispara só a pílula curta. O usuário pega o texto denso depois,
 * com o gatilho "pode mandar" (release_pending). Esse é o anti-textão — a pesquisa
 * PRODUZ o pendente; quem libera é o release.
 *
 * Tolerante a falha de fonte: das top 3 URLs, ignora as que não extraírem e segue com
 * as que vierem; se NENHUMA extrair, cai para usar as `description` da própria Brave.
 */
import { braveSearch } from "./search.ts";
import { extractArticle } from "./extract.ts";
import { summarizeFeynman } from "./summarize.ts";
import { enqueuePending } from "./release.ts";
import { sendWhatsApp } from "./notify.ts";

const SOURCES_TO_OPEN = 3; // quantas das top URLs tentamos abrir (extract)
const MAX_SOURCE_CHARS = 6_000; // teto por fonte ao consolidar (o Gemini já trunca o todo)

async function main(): Promise<void> {
  const query = (process.argv[2] ?? "").trim();
  const chat = (process.argv[3] ?? "").trim();
  if (!query) {
    console.error("[search-worker] ABORT: query vazia (argv[2])");
    process.exit(2);
  }
  if (!chat) {
    // Sem destino não há pra onde mandar a pílula — aborta cedo (não gasta Brave/Gemini).
    console.error("[search-worker] ABORT: chat de destino vazio (argv[3])");
    process.exit(2);
  }

  // 1. Brave Search
  const search = await braveSearch(query);
  if (!search.ok) {
    const aviso =
      search.error === "brave_rate_limit"
        ? `😕 bati o limite de pesquisas do mês — tenta de novo mais tarde.`
        : search.error === "brave_no_results"
          ? `🔍 não achei nada sobre *${query}*.`
          : search.error === "brave_no_key"
            ? `⚠️ a pesquisa web não está configurada (sem chave da Brave).`
            : `⚠️ não consegui pesquisar agora (${search.error}).`;
    console.error(`[search-worker] busca falhou: ${search.error}`);
    await sendWhatsApp(chat, aviso);
    return;
  }
  const results = search.results;
  console.error(`[search-worker] ${results.length} resultado(s) para "${query}"`);

  // 2. Abre as top N URLs (tolerante a falha individual: ignora as que falharem).
  const sources: { url: string; title?: string; text: string }[] = [];
  for (const r of results.slice(0, SOURCES_TO_OPEN)) {
    const captured = await extractArticle(r.url);
    if (captured.ok && captured.text) {
      sources.push({ url: captured.url, title: captured.title ?? r.title, text: captured.text });
    } else {
      console.error(`[search-worker] fonte falhou (${captured.error}): ${r.url}`);
    }
  }

  // Fallback: se NENHUMA fonte extraiu, usa as descrições da própria Brave como texto.
  if (sources.length === 0) {
    console.error(`[search-worker] nenhuma fonte extraída — usando descrições da Brave`);
    for (const r of results) {
      if (r.description.trim()) sources.push({ url: r.url, title: r.title, text: r.description });
    }
  }

  if (sources.length === 0) {
    console.error(`[search-worker] sem texto para resumir (no_sources_readable)`);
    await sendWhatsApp(chat, `😕 achei links sobre *${query}* mas não consegui ler o conteúdo deles.`);
    return;
  }

  // 3. Consolida o texto das fontes (query no topo + separadores) e resume.
  const consolidated = [
    `Pergunta de pesquisa: ${query}`,
    ...sources.map((s, i) => `\n--- Fonte ${i + 1}: ${s.title ?? s.url} (${s.url}) ---\n${s.text.slice(0, MAX_SOURCE_CHARS)}`),
  ].join("\n");

  const summary = await summarizeFeynman(consolidated);
  if (!summary.ok) {
    console.error(`[search-worker] resumo falhou: ${summary.error}`);
    await sendWhatsApp(chat, `😕 pesquisei sobre *${query}* mas não consegui montar o resumo (${summary.error}).`);
    return;
  }
  const card = summary.card;

  // 4. RETÉM como pendente (anti-textão): grava PENDING_RELEASE e dispara só a pílula
  // curta. O texto denso sai depois, com "pode mandar" (release_pending). NÃO mandamos
  // o card cheio aqui.
  const { id } = await enqueuePending(chat, card, {
    type: "RESEARCH",
    topico: query || card.topico,
    title: card.topico ?? query,
  });
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
