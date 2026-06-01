# F1.2 — Tool `fetch_web_content` (scraper universal)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** ✅ DONE (2026-06-01) — P0–P4 completos; **E2E pelo WhatsApp validado** (URL real → `[C] mcp__web__fetch_web_content` no `genie agent log` → resumo curto).
**Depende de:** F0.2 (tool harness — `.mcp.json` + `settings.local.json`, doc em `tools/README.md`) ✅
**Habilita:** F1.4 (Feynman consome o texto extraído), F1.1 (rota LINK_PARA_ARQUIVAR aciona esta tool).

## Goal

Dar ao agente a **primeira tool real de captura**: receber uma URL e devolver o
**conteúdo central legível** da página (texto do artigo), descartando ads, menus e
navegação. É a entrada do pipeline de arquivamento (link → conteúdo → Feynman → save).

> **Escopo:** só extração de **páginas web genéricas**. YouTube é a F1.3 (tool separada).
> Sumarização Feynman é F1.4. Persistência é F1.5. Aqui só entregamos texto limpo.

## Scope

**In:**
1. Nova tool `tools/fetch-web-content/` (MCP stdio server Bun, conforme `tools/README.md`).
2. Tool `fetch_web_content(url)` → conteúdo principal extraído (título + texto limpo + metadados básicos).
3. Extração via **Readability** (Mozilla `@mozilla/readability`) sobre um DOM parseado.
4. Remoção de ruído (ads, nav, footer, scripts) — herdada do Readability.
5. **Limites de robustez:** timeout de fetch, limite de tamanho do body, User-Agent definido.
6. **Tratamento de erros** estruturado: URL inválida, timeout, 4xx/5xx, conteúdo não-HTML, página sem conteúdo extraível.
7. Registro no agente (`.mcp.json` + `permissions.allow`) e validação E2E pelo WhatsApp.

**Out (outras features):**
- Detecção de intenção / roteamento (F1.1) — aqui a tool é chamada explicitamente.
- YouTube transcript (F1.3), Feynman (F1.4), persistência Postgres (F1.5), Brave (F1.6).
- Render de JS / páginas SPA que exigem browser headless (Playwright) — **fora do v1**; se a página não entrega conteúdo no HTML estático, retornar erro claro (ver Open questions).
- Paywall bypass.

## Definition of Done

- [ ] `tools/fetch-web-content/server.ts` expõe `fetch_web_content` (input `url: string`).
- [ ] Dado um artigo real (ex.: post de blog), retorna título + texto central limpo (sem menu/ads), truncado ao limite.
- [ ] Erros retornam mensagem estruturada (não stack trace): URL inválida, timeout, status HTTP ruim, sem conteúdo extraível, content-type não-HTML.
- [ ] Tool registrada em `agents/linkmind-agent/.mcp.json` + auto-aprovada (`mcp__web__fetch_web_content` em `settings.local.json`).
- [ ] Validação E2E: mandar uma URL no WhatsApp → agente chama a tool → devolve um resumo curtinho do que extraiu (anti-textão), com o tool call visível em `genie agent log`.
- [ ] README curto da tool em `tools/fetch-web-content/` (o que faz, limites, erros).

## Design

### Interface da tool

```ts
fetch_web_content(url: string) -> {
  ok: boolean
  url: string            // URL final (após redirects)
  title?: string
  byline?: string        // autor, se Readability achar
  text?: string          // conteúdo central, texto puro, truncado a MAX_CHARS
  excerpt?: string       // primeiro parágrafo / resumo do Readability
  length?: number        // nº de chars antes do truncamento
  truncated?: boolean
  error?: string         // preenchido quando ok=false (categoria + detalhe)
}
```

Retornar **objeto JSON** (não texto solto) para a F1.4 consumir programaticamente
depois. O agente, ao responder no WhatsApp, resume — não despeja o `text` inteiro.

### Stack

- `tools/fetch-web-content/` = projeto Bun isolado (vide `tools/README.md`).
- **`@mozilla/readability`** para extração do conteúdo principal.
- **DOM parser:** decidir entre `jsdom` (canônico, mais pesado, possível atrito no Bun)
  vs **`linkedom`** (leve, rápido, mais amigável ao Bun). → **Open question / spike P0.**
- `fetch` nativo do Bun para baixar o HTML (com `AbortController` p/ timeout).
- `zod` para o input schema.

### Limites e robustez

- `TIMEOUT_MS` (default 10s) via `AbortController`.
- `MAX_BYTES` no download (abortar/streamar corte se exceder, ex. 5 MB).
- `MAX_CHARS` no `text` retornado (ex. 20k chars) → setar `truncated`.
- `User-Agent` explícito (não o default do fetch) p/ reduzir bloqueio.
- Validar `content-type: text/html` antes de parsear; senão erro `unsupported_content_type`.
- Seguir redirects (fetch default), mas reportar `url` final.

### Categorias de erro (`error`)

`invalid_url` | `timeout` | `http_error:<status>` | `unsupported_content_type` | `too_large` | `no_content` (Readability não extraiu) | `fetch_failed:<motivo>`.

## Stories / tarefas

- **P0 — Spike DOM parser:** ✅ **CONCLUÍDO.** `linkedom` escolhido: mesma extração do `jsdom` (mesmo título/texto/chars em 2 artigos reais) porém ~6-7x mais rápido sob Bun. `jsdom` removido das deps.
- **P1 — Tool core:** ✅ **CONCLUÍDO.** `tools/fetch-web-content/server.ts` expõe `fetch_web_content(url)` (fetch + UA + timeout 10s + `MAX_BYTES` 5MB + Readability/linkedom + `MAX_CHARS` 20k + retorno JSON). Validado standalone: blog real → `ok:true`, título, excerpt, 63k chars, `truncated:true`.
- **P2 — Tratamento de erros:** ✅ **CONCLUÍDO.** Validado standalone: URL inválida → `invalid_url`; 404 → `http_error:404` (check `res.ok` evita extrair lixo da página de erro); PDF → `unsupported_content_type:application/pdf`. Demais categorias implementadas (`timeout`, `too_large`, `no_content`, `fetch_failed`, `parse_failed`).
- **P3 — Registro + E2E WhatsApp:** ✅ **CONCLUÍDO.** Registro (`.mcp.json` server `web` + `permissions.allow: mcp__web__fetch_web_content`) + **E2E validado** (2026-06-01): URL real no WhatsApp → `[C] mcp__web__fetch_web_content` no `genie agent log` → resposta curta resumindo.
- **P4 — README da tool:** ✅ **CONCLUÍDO.** `tools/fetch-web-content/README.md` (stack, interface, limites, erros, como testar/registrar).

## Validação

1. **Artigo real:** URL de um post de blog → `ok:true`, `title` preenchido, `text` sem menu/ads/footer.
2. **Robustez:** URL inválida → `invalid_url`; host morto → `fetch_failed`; 404 → `http_error:404`; link de PDF → `unsupported_content_type`; timeout simulado → `timeout`.
3. **E2E:** mensagem WhatsApp com uma URL → tool chamada (`[C] mcp__web__fetch_web_content` no log) → resposta curta resumindo o conteúdo (não o texto inteiro).

## Open questions

- ~~**`jsdom` vs `linkedom` sob Bun**~~ → **RESOLVIDO (P0): `linkedom`** (mesma extração, ~6-7x mais rápido).
- **Páginas que exigem JS (SPA)** — só detectar e retornar `no_content` no v1, ou já prever fallback Playwright? Decisão: **só detectar/erro no v1** (Playwright é candidato a feature futura se a fricção doer).
- ~~**Nome do server MCP**~~ → **RESOLVIDO: `web`** (→ `mcp__web__fetch_web_content`), p/ agrupar futuras tools de rede.
- **Cache** — vale cachear por URL já no v1 (evitar re-fetch)? Provavelmente **não** no v1; anotar como ideia.
