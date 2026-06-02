/**
 * F1.6 / P0 — Wrapper sobre a Brave Search API (pesquisa web sob demanda).
 *
 * `braveSearch(query)` faz UMA requisição GET ao endpoint de web search da Brave,
 * mapeia os top resultados para `{title,url,description}` e trata os erros (429,
 * outros HTTP, sem resultados, sem chave) no mesmo padrão `{ok:false,error}` do
 * extract.ts/summarize.ts. A chave fica SÓ em env (`BRAVE_API_KEY`); o `fetch` é
 * injetável para teste (mock HTTP) sem tocar a rede.
 *
 * TODO (F1.6 / P4 — adiado): guarda de cota (contador de uso por mês) pra não
 * estourar silenciosamente o free tier (2k queries/mês). Hoje só repassamos o 429
 * da Brave como `brave_rate_limit`; um contador local fica para depois (evita acoplar
 * DB aqui agora).
 */

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 8_000;
const TOP_N = 5; // quantos resultados Brave mapeamos no máximo (spec: top 5)

export type SearchResult =
  | { ok: true; results: { title: string; url: string; description: string }[] }
  | { ok: false; error: string };

/**
 * Pesquisa na web via Brave Search. `deps.fetch` é injetável só para teste
 * (default = `fetch` global); `deps.apiKey` default = `process.env.BRAVE_API_KEY`.
 * Sem chave → `brave_no_key` SEM tocar a rede. 200 → top N parseados; 429 →
 * `brave_rate_limit`; outro não-2xx → `brave_http:<status>`; vazio → `brave_no_results`.
 */
export async function braveSearch(
  query: string,
  deps?: { fetch?: typeof fetch; apiKey?: string },
): Promise<SearchResult> {
  const fetchImpl = deps?.fetch ?? fetch;
  const apiKey = deps?.apiKey ?? process.env.BRAVE_API_KEY ?? "";

  // Sem chave não vale gastar requisição — falha cedo, sem tocar a rede.
  if (!apiKey.trim()) return { ok: false, error: "brave_no_key" };

  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "timeout" : `fetch_failed:${(e as Error).message}`;
    return { ok: false, error: `brave_${msg}` };
  }

  // 429 = cota/rate limit estourado → aviso honesto separado dos demais HTTP.
  if (res.status === 429) return { ok: false, error: "brave_rate_limit" };
  if (!res.ok) return { ok: false, error: `brave_http:${res.status}` };

  let body: any;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, error: `brave_bad_json:${(e as Error).message}` };
  }

  const raw = Array.isArray(body?.web?.results) ? body.web.results : [];
  if (raw.length === 0) return { ok: false, error: "brave_no_results" };

  // Só os 3 campos do contrato — nada de campos crus da Brave vazando.
  const results = raw.slice(0, TOP_N).map((r: any) => ({
    title: String(r?.title ?? ""),
    url: String(r?.url ?? ""),
    description: String(r?.description ?? ""),
  }));

  return { ok: true, results };
}

// --- harness standalone: `bun run search.ts <query>` (igual recall.ts/release.ts) ---
if (import.meta.main) {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("uso: bun run search.ts <query>");
    process.exit(2);
  }
  const res = await braveSearch(query);
  console.error(
    res.ok ? `[search] ${res.results.length} resultado(s) para "${query}"` : `[search] erro: ${res.error}`,
  );
  console.log(JSON.stringify(res, null, 2));
}
