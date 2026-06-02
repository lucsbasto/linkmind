/**
 * F1.10 — testes unitários de `extractArticle` (F1.2 `fetch_web_content`).
 *
 * Contrato derivado da spec F1.2 (`.specs/features/F1.2-fetch-web-content/spec.md`),
 * seção "Categorias de erro":
 *   invalid_url | timeout | http_error:<status> | unsupported_content_type | too_large | no_content
 *
 * NUNCA toca a rede: `fetch` é injetado (param opcional de `extractArticle`).
 */
import { describe, it, expect } from "bun:test";
import { extractArticle } from "../../extract.ts";

const SAMPLE_HTML = await Bun.file(
  new URL("../fixtures/article-sample.html", import.meta.url),
).text();
const EMPTY_HTML = await Bun.file(
  new URL("../fixtures/article-empty.html", import.meta.url),
).text();

/** Constrói um fetch falso que devolve uma Response controlada (sem rede). */
function mockFetch(opts: {
  status?: number;
  contentType?: string;
  contentLength?: number;
  body?: string;
  finalUrl?: string;
}): typeof fetch {
  const {
    status = 200,
    contentType = "text/html; charset=utf-8",
    body = "",
    finalUrl,
  } = opts;
  return (async (input: any) => {
    const requested =
      typeof input === "string" ? input : (input?.href ?? String(input));
    const headers = new Headers();
    if (contentType) headers.set("content-type", contentType);
    if (opts.contentLength != null)
      headers.set("content-length", String(opts.contentLength));
    return {
      ok: status >= 200 && status < 300,
      status,
      url: finalUrl ?? requested,
      headers,
      text: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** fetch falso que lança — para simular timeout / falha de rede. */
function throwingFetch(error: Error): typeof fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

describe("extractArticle — sucesso", () => {
  it("URL http(s) válida + HTML de artigo → ok:true com título e texto extraído (nav/ads removidos)", async () => {
    const res = await extractArticle(
      "https://blog.exemplo.com/memoria",
      mockFetch({ body: SAMPLE_HTML }),
    );

    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.title).toContain("memória de trabalho");

    const text = res.text ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(res.length).toBe(text.length);
    // corpo do artigo presente
    expect(text).toContain("memória de trabalho é o sistema cognitivo");
    // ruído de navegação / anúncios removido pelo Readability
    expect(text).not.toContain("PUBLICIDADE");
    expect(text).not.toContain("Assine nossa newsletter");
    expect(text).not.toContain("Todos os direitos reservados");
  });
});

describe("extractArticle — contrato de erros (spec F1.2)", () => {
  it("protocolo não-http (ftp://) → invalid_url", async () => {
    const res = await extractArticle(
      "ftp://exemplo.com/arquivo",
      mockFetch({ body: SAMPLE_HTML }),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.startsWith("invalid_url")).toBe(true);
  });

  it("protocolo file:// → invalid_url", async () => {
    const res = await extractArticle(
      "file:///etc/passwd",
      mockFetch({ body: SAMPLE_HTML }),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.startsWith("invalid_url")).toBe(true);
  });

  it("URL malformada → invalid_url", async () => {
    const res = await extractArticle(
      "não é uma url",
      mockFetch({ body: SAMPLE_HTML }),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.startsWith("invalid_url")).toBe(true);
  });

  it("404 → http_error:404", async () => {
    const res = await extractArticle(
      "https://exemplo.com/some",
      mockFetch({ status: 404, body: "<h1>Not Found</h1>" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("http_error:404");
  });

  it("content-type não-HTML (application/pdf) → unsupported_content_type:application/pdf", async () => {
    const res = await extractArticle(
      "https://exemplo.com/doc.pdf",
      mockFetch({ contentType: "application/pdf", body: "%PDF-1.7" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("unsupported_content_type:application/pdf");
  });

  it("content-length acima do máximo (5MB) → too_large", async () => {
    const res = await extractArticle(
      "https://exemplo.com/gigante",
      mockFetch({ contentLength: 6_000_000, body: SAMPLE_HTML }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("too_large");
  });

  it("fetch lança TimeoutError → timeout", async () => {
    const timeoutError = new Error("the operation timed out");
    timeoutError.name = "TimeoutError";
    const res = await extractArticle(
      "https://exemplo.com/lento",
      throwingFetch(timeoutError),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("timeout");
  });

  it("HTML sem corpo de artigo real → no_content", async () => {
    const res = await extractArticle(
      "https://exemplo.com/vazio",
      mockFetch({ body: EMPTY_HTML }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no_content");
  });
});
