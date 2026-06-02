/**
 * Captura de conteúdo web — miolo reaproveitado da F1.2 (`fetch_web_content`).
 *
 * Self-contained aqui (deps próprios) em vez de importar do projeto da F1.2:
 * cada tool tem `node_modules` isolado, então cross-import acoplaria mal. A lógica
 * é a mesma já validada na F1.2 (fetch + UA + timeout + linkedom/Readability + limites).
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5_000_000; // 5 MB de HTML
const USER_AGENT = "LinkMind/0.1 (+https://github.com/linkmind; segundo cerebro pessoal)";

export type ExtractResult = {
  ok: boolean;
  url: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  text?: string;
  length?: number;
  error?: string;
};

/**
 * `fetchImpl` é injetável só para teste (default = `fetch` global). Em uso normal
 * o comportamento é idêntico ao de antes; os testes passam um mock para não tocar a rede.
 */
export async function extractArticle(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, url: rawUrl, error: "invalid_url: protocolo não suportado" };
    }
  } catch {
    return { ok: false, url: rawUrl, error: "invalid_url" };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "timeout" : `fetch_failed:${(e as Error).message}`;
    return { ok: false, url: url.href, error: msg };
  }

  const finalUrl = res.url || url.href;
  if (!res.ok) return { ok: false, url: finalUrl, error: `http_error:${res.status}` };

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return { ok: false, url: finalUrl, error: `unsupported_content_type:${contentType.split(";")[0] || "desconhecido"}` };
  }

  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return { ok: false, url: finalUrl, error: "too_large" };
  }

  let html: string;
  try {
    html = await res.text();
  } catch (e) {
    return { ok: false, url: finalUrl, error: `fetch_failed:${(e as Error).message}` };
  }
  if (html.length > MAX_BYTES) return { ok: false, url: finalUrl, error: "too_large" };

  let article: ReturnType<Readability["parse"]>;
  try {
    const { document } = parseHTML(html);
    article = new Readability(document as any).parse();
  } catch (e) {
    return { ok: false, url: finalUrl, error: `parse_failed:${(e as Error).message}` };
  }

  const fullText = article?.textContent?.trim() ?? "";
  if (!article || fullText.length === 0) {
    return { ok: false, url: finalUrl, error: "no_content" };
  }

  return {
    ok: true,
    url: finalUrl,
    title: article.title ?? undefined,
    byline: article.byline ?? undefined,
    excerpt: article.excerpt ?? undefined,
    length: fullText.length,
    text: fullText,
  };
}
