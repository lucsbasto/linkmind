# fetch-web-content

Tool MCP `fetch_web_content` — **scraper universal** do LinkMind (feature F1.2).
Baixa uma URL e extrai o **conteúdo central legível** (título + texto do artigo),
descartando ads, menus e navegação. Saída em **JSON estruturado** (a sumarização
Feynman — F1.4 — consome esse JSON depois).

## Stack

- **Bun** (runtime) — server MCP stdio, conforme [`../README.md`](../README.md).
- **`@mozilla/readability`** — extração do conteúdo principal.
- **`linkedom`** — parser DOM. Escolhido no spike P0: mesma extração do `jsdom`,
  porém ~6-7x mais rápido e mais leve sob Bun.

## Interface

```ts
fetch_web_content(url: string) -> {
  ok: boolean
  url: string         // URL final (após redirects)
  title?: string
  byline?: string     // autor, se Readability achar
  text?: string       // conteúdo central, texto puro, truncado a MAX_CHARS (20k)
  excerpt?: string    // resumo curto do Readability
  length?: number     // tamanho do texto ANTES do truncamento
  truncated?: boolean
  error?: string      // preenchido quando ok=false (ver categorias)
}
```

### Limites (constantes no `server.ts`)

| Constante | Valor | Efeito |
|---|---|---|
| `TIMEOUT_MS` | 10s | aborta o fetch e retorna `timeout` |
| `MAX_BYTES` | 5 MB | HTML maior → `too_large` |
| `MAX_CHARS` | 20k | texto maior é cortado e `truncated=true` |

### Categorias de erro (`error`)

`invalid_url` · `timeout` · `http_error:<status>` · `unsupported_content_type:<mime>` ·
`too_large` · `no_content` (Readability não extraiu nada) · `fetch_failed:<motivo>` ·
`parse_failed:<motivo>`.

> Páginas que dependem de JS (SPA) tendem a cair em `no_content` — render headless
> (Playwright) está **fora do v1**.

## Testar standalone

```bash
# listar tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun run server.ts

# chamar a tool (handshake + call)
printf '%s\n' \
 '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch_web_content","arguments":{"url":"https://example.com"}}}' \
 | bun run server.ts
```

## Registro no agente

Já registrado em `agents/linkmind-agent/.mcp.json` (server `web`) e auto-aprovado
em `.claude/settings.local.json` (`mcp__web__fetch_web_content`). Verificar uso real:

```bash
genie agent log linkmind-agent | grep fetch_web_content
```
