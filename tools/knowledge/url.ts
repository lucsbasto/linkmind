/**
 * Validação de URL http(s) compartilhada (worker de arquivamento + tool
 * `archive_link`). Módulo deliberadamente SEM deps pesadas: o `server.ts`
 * (processo longo) importa só isto, sem puxar linkedom/Readability do `extract.ts`.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Valida que `raw` é uma URL http(s). Não toca a rede. */
export function validateHttpUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "invalid_url: protocolo não suportado" };
  }
  return { ok: true, url };
}
