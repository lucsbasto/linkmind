/**
 * F1.6 — Pesquisa web sob demanda via **Gemini CLI nativo (grounding)**.
 *
 * Decisão (2026-06-02, pedido do usuário): em vez da Brave Search API (chave extra +
 * scraping próprio), usamos a busca web embutida do Gemini CLI (`google_web_search`).
 * Um único `gemini -p` pesquisa, lê e sintetiza no estilo Feynman — devolve o card
 * + as fontes consultadas. Remove o `BRAVE_API_KEY` (um a menos pra provisionar no
 * MVP local) e o scrape redundante.
 *
 * `researchWeb(query)` reusa o seam `_internals.runGemini` do summarize.ts (mesmo
 * shell-out headless), então continua 100% mockável nos testes (sem spawnar o
 * binário, sem rede). Valida o card com `CardSchema` (zod) e faz 1 retry reforçado.
 *
 * Trade-off aceito: o grounding devolve resposta sintetizada + citações, não o HTML
 * cru das páginas — pro card Feynman (que é resumo) basta; só não dá `ask_article`
 * sobre uma pesquisa depois (pesquisa não é "um artigo" único).
 */
import { CardSchema, extractJson, _internals, type FeynmanCard } from "./summarize.ts";

export type ResearchSource = { title: string; url: string };

export type SearchResult =
  | { ok: true; card: FeynmanCard; sources: ResearchSource[] }
  | { ok: false; error: string };

type RunGemini = (promptText: string, stdinText: string) => Promise<string>;

function buildPrompt(query: string, reinforce: boolean): string {
  const base = [
    "Você é um pesquisador. USE a ferramenta de busca web (google_web_search) para",
    `pesquisar sobre o tema abaixo e sintetizar o que encontrar, no estilo Feynman.`,
    ``,
    `TEMA: "${query}"`,
    ``,
    "Responda APENAS com um objeto JSON válido (sem markdown, sem cercas ```), com exatamente estas chaves:",
    '- "ideia_central": uma frase com a ideia central sobre o tema.',
    '- "pilares": array de 2 a 5 strings, cada uma um aprendizado/ponto essencial.',
    '- "aplicacao": uma frase sobre como aplicar isso na prática.',
    '- "topico": um tópico curto (2-4 palavras) que identifique o assunto, para busca futura.',
    '- "fontes": array de 1 a 5 objetos {"titulo": string, "url": string} com as páginas que você consultou na busca.',
    "Escreva em português. Baseie-se NO QUE ENCONTROU na busca; não invente fatos nem URLs.",
  ];
  if (reinforce) {
    base.push(
      "",
      "IMPORTANTE: sua resposta anterior não era um JSON válido no formato pedido.",
      "Responda SOMENTE o JSON, começando com { e terminando com }, sem texto antes ou depois.",
    );
  }
  return base.join("\n");
}

/** Lê o array `fontes` do JSON do Gemini, tolerante (titulo|title, descarta sem url). */
function parseSources(obj: unknown): ResearchSource[] {
  const raw = (obj as any)?.fontes;
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5)
    .map((f: any) => ({ title: String(f?.titulo ?? f?.title ?? ""), url: String(f?.url ?? "") }))
    .filter((s: ResearchSource) => s.url.trim());
}

/**
 * Pesquisa na web via Gemini (grounding) e devolve um card Feynman + fontes.
 * `deps.runGemini` é injetável só para teste (default = seam real do summarize.ts).
 * JSON inválido 2× → `{ ok:false, error:"gemini_bad_json: ..." }` (mesmo padrão do
 * summarizeFeynman). Query vazia → erro sem tocar o Gemini.
 */
export async function researchWeb(
  query: string,
  deps?: { runGemini?: RunGemini },
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: "query vazia" };
  const run = deps?.runGemini ?? _internals.runGemini;

  let lastErr = "";
  for (const reinforce of [false, true]) {
    try {
      const raw = await run(buildPrompt(q, reinforce), "");
      const obj = extractJson(raw);
      const parsed = CardSchema.safeParse(obj);
      if (parsed.success) {
        return { ok: true, card: parsed.data, sources: parseSources(obj) };
      }
      lastErr = `validação falhou: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { ok: false, error: `gemini_bad_json: ${lastErr}` };
}

// --- harness standalone: `bun run search.ts <query>` (igual recall.ts/release.ts) ---
if (import.meta.main) {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("uso: bun run search.ts <query>");
    process.exit(2);
  }
  console.error(`[search] pesquisando "${query}" via Gemini (grounding)...`);
  const res = await researchWeb(query);
  console.error(
    res.ok
      ? `[search] ok — tópico "${res.card.topico}", ${res.sources.length} fonte(s)`
      : `[search] erro: ${res.error}`,
  );
  console.log(JSON.stringify(res, null, 2));
}
