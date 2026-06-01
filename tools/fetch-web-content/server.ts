// Tool MCP `fetch_web_content` — scraper universal (F1.2).
// Baixa uma URL e devolve o conteúdo central legível (via @mozilla/readability +
// linkedom), descartando ads/menu/nav. Retorna JSON estruturado para a F1.4 consumir.
// Registro no agente = .mcp.json + .claude/settings.local.json (ver ../README.md).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { z } from "zod";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5_000_000; // 5 MB de HTML
const MAX_CHARS = 20_000; // texto retornado
const USER_AGENT = "LinkMind/0.1 (+https://github.com/linkmind; segundo cerebro pessoal)";

type FetchResult = {
  ok: boolean;
  url: string;
  title?: string;
  byline?: string;
  text?: string;
  excerpt?: string;
  length?: number;
  truncated?: boolean;
  error?: string;
};

async function fetchWebContent(rawUrl: string): Promise<FetchResult> {
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
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "timeout" : `fetch_failed:${(e as Error).message}`;
    return { ok: false, url: url.href, error: msg };
  }

  const finalUrl = res.url || url.href;

  if (!res.ok) {
    return { ok: false, url: finalUrl, error: `http_error:${res.status}` };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return { ok: false, url: finalUrl, error: `unsupported_content_type:${contentType.split(";")[0] || "desconhecido"}` };
  }

  const declaredLen = Number(res.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_BYTES) {
    return { ok: false, url: finalUrl, error: "too_large" };
  }

  let html: string;
  try {
    html = await res.text();
  } catch (e) {
    return { ok: false, url: finalUrl, error: `fetch_failed:${(e as Error).message}` };
  }
  if (html.length > MAX_BYTES) {
    return { ok: false, url: finalUrl, error: "too_large" };
  }

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

  const truncated = fullText.length > MAX_CHARS;
  return {
    ok: true,
    url: finalUrl,
    title: article.title ?? undefined,
    byline: article.byline ?? undefined,
    excerpt: article.excerpt ?? undefined,
    length: fullText.length,
    truncated,
    text: truncated ? fullText.slice(0, MAX_CHARS) : fullText,
  };
}

const server = new McpServer({ name: "web", version: "0.1.0" });

server.registerTool(
  "fetch_web_content",
  {
    title: "Fetch Web Content",
    description:
      "Baixa uma URL e extrai o conteúdo central legível (título + texto do artigo), " +
      "descartando ads, menus e navegação. Use para arquivar/resumir links. " +
      "NÃO use para YouTube (tool separada). Retorna JSON; resuma o resultado, não despeje o texto inteiro.",
    inputSchema: { url: z.string().describe("URL http(s) da página a extrair") },
  },
  async ({ url }) => {
    const result = await fetchWebContent(url);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
