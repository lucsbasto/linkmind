# F1.6 — Tool `search_web_knowledge` (pesquisa web sob demanda)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 📝 SPEC (2026-06-02) — não iniciada.
**Depende de:** F0.2 (tool harness) ✅ · F1.4 (worker assíncrono + `summarizeFeynman` + persistência — reusados) ✅ · **F1.7** (o gatilho anti-textão "pode mandar" é o par natural desta feature; podem ser specadas/entregues juntas) 📝 · F1.1 (roteia a intenção `DUVIDA_PESQUISAR` pra cá) 📝.
**Habilita:** o **2º pilar do produto** (PROJECT Goal "Pesquisa anti-textão"). Hoje o `AGENTS.md` declara que pesquisa web **não existe**.

> **Origem:** ROADMAP F1.6 — "Wrapper sobre Brave Search API com chave em env; consolidação de top resultados em resumo Feynman; tratamento de rate limit + erros HTTP." Decisão 2026-05-31: provedor = **Brave Search API** (free tier 2k queries/mês).

## Goal

Para uma **dúvida factual** do usuário ("como funciona X", "qual a diferença entre Y e Z"),
executar uma pesquisa web em segundo plano, **consolidar** os melhores resultados num resumo
Feynman, e devolvê-lo no WhatsApp — respeitando o **anti-textão**: notificação curta primeiro,
texto denso só sob comando (gatilho da F1.7). Usuário pergunta → "já pesquisei, é só pedir" →
"pode mandar" → resumo completo.

## Arquitetura: reusa o desenho assíncrono do `archive_link`

Pesquisar + abrir os top resultados + resumir é **lento** (várias requisições + Gemini). Mesmo
problema do `archive_link` → **mesma solução**: tool dispara worker detached, retorna na hora.

- `search_web_knowledge(query, chat)` (server `knowledge` ou um server `search` novo) valida a
  query e dispara `setsid bun run search-worker.ts <query> <chat>`; retorna `{ok, status:"processing"}`.
- `search-worker.ts`: Brave Search API → pega top N URLs → `extractArticle` em cada (reusa o
  miolo da F1.2/`extract.ts`) → concatena os textos → `summarizeFeynman(textoConsolidado)` →
  **persiste como pendente** (status `PENDING_RELEASE`, F1.7) → manda só a **pílula curta**
  ("🔎 pesquisei sobre *X*, é só pedir 'manda' que te mando o resumo").
- O resumo completo só vai ao chat quando o usuário disparar o gatilho → `release_pending` (F1.7).

> **Se F1.7 não estiver pronta ainda:** v1 mínimo pode mandar o card direto (sem o passo
> PENDING_RELEASE), perdendo o anti-textão mas entregando a pesquisa. Decisão: **specar as
> duas juntas** e entregar o fluxo completo; o atalho fica como fallback só se o cronograma
> apertar (ver Open questions).

## Scope

**In:**
1. Wrapper Brave Search API: `braveSearch(query): Promise<{title,url,description}[]>` — chave em env (`BRAVE_API_KEY`), timeout, top N (ex.: 5).
2. `search-worker.ts`: orquestra Brave → fetch dos top resultados (`extractArticle`, tolerante a falha individual: ignora o que falhar, segue com os que vieram) → consolida → `summarizeFeynman` → persiste pendente → pílula curta.
3. Persistência do resultado de pesquisa em `knowledge_node` (ou tabela irmã) com `type=RESEARCH` + `status=PENDING_RELEASE` + as fontes (URLs) — alinhar com F1.5 (schema) e F1.7 (release).
4. `search_web_knowledge(query, chat)` registrada + `AGENTS.md` (intenção `DUVIDA_PESQUISAR`).
5. **Tratamento de rate limit + erros HTTP:** 429 (cota Brave estourada) → aviso curto e honesto ("bati o limite de pesquisas do mês, tenta de novo depois"); erro de rede → aviso; 0 resultados → "não achei nada sobre isso".
6. Guarda de cota: contar/logar uso pra não estourar silenciosamente os 2k/mês.

**Out:**
- O gatilho de release "pode mandar" em si = **F1.7** (esta feature produz o pendente; F1.7 libera).
- Roteamento da intenção = **F1.1** (esta feature só expõe a tool).
- Cruzamento da pesquisa com notas salvas (Zettelkasten) = F2.1.
- Múltiplos provedores de busca / fallback de provedor — v1 só Brave.

## Definition of Done

- [ ] `braveSearch(query)` retorna top resultados (title/url/description) com chave de env, timeout e tratamento de 429/erro HTTP.
- [ ] `search-worker.ts`: Brave → fetch tolerante dos top N → consolidação → `summarizeFeynman` → persiste pendente → pílula curta. Falha de 1 fonte não derruba o todo.
- [ ] Resultado persistido com `type=RESEARCH`, `status=PENDING_RELEASE` e as **fontes** (URLs citáveis).
- [ ] `search_web_knowledge(query, chat)` registrada (`.mcp.json` + `settings.local.json`) + `AGENTS.md` atualizado (remove "pesquisa não existe").
- [ ] Rate limit/erros tratados com aviso curto e honesto (sem alucinar resposta quando a busca falhou).
- [ ] Guarda de cota (contagem de uso) pra não estourar 2k/mês silenciosamente.
- [ ] **E2E WhatsApp:** pergunta factual → pílula curta "já pesquisei, é só pedir" → (com F1.7) "manda" → resumo Feynman com as fontes.

## Design

### Brave Search API

`GET https://api.search.brave.com/res/v1/web/search?q=<query>` com header
`X-Subscription-Token: <BRAVE_API_KEY>`. Pegar `web.results[].{title,url,description}`. Free
tier: 2k/mês, ~1 req/s → respeitar. Chave **só em env/`.env`** (nunca versionada — ver F1.9).

### Consolidação

Top N (5) resultados → `extractArticle` em cada (já temos), concatenar com cabeçalho da fonte,
truncar ao `MAX_CHARS` do Gemini, `summarizeFeynman` sobre o consolidado. O card resultante +
a lista de URLs-fonte vão pro `knowledge_node`. Pílula curta NÃO contém o resumo (anti-textão).

### Erros (`error`)

`brave_rate_limit` (429) | `brave_http:<status>` | `brave_no_results` | `no_sources_readable`
(achou URLs mas nenhuma extraiu) | `gemini_bad_json` | `db_failed`. Cada um → aviso curto.

## Validação

1. **Brave standalone:** `braveSearch("o que é MCP")` → ≥1 resultado; query absurda → `no_results`.
2. **Worker standalone:** `search-worker.ts "<dúvida>" <chat>` → pendente salvo + pílula enviada; conferir `SELECT` (`type=RESEARCH`, `status=PENDING_RELEASE`).
3. **Robustez:** cota estourada (simular 429) → aviso; 1 fonte 404 entre 5 → segue com 4.
4. **E2E:** dúvida no WhatsApp → pílula → (F1.7) gatilho → resumo + fontes.

## Test Cases

| ID | Tipo | Cenário | Esperado |
|---|---|---|---|
| SR-01 | unit (mock HTTP) | resposta Brave 200 com `web.results[]` | lista `{title,url,description}` parseada |
| SR-02 | unit (mock HTTP) | Brave responde **429** | `error: brave_rate_limit` + aviso curto honesto |
| SR-03 | unit (mock HTTP) | Brave responde 5xx/4xx | `error: brave_http:<status>` |
| SR-04 | unit (mock HTTP) | `web.results` vazio | `error: brave_no_results` → "não achei nada" |
| SR-05 | integração | worker com N fontes válidas | consolida e gera card Feynman |
| SR-06 | integração | 1 de 5 fontes dá 404 | segue com as 4 restantes (tolerante) |
| SR-07 | integração | **todas** as fontes falham ao extrair | `error: no_sources_readable` |
| SR-08 | unit (mock Gemini) | Gemini devolve lixo 2× | `error: gemini_bad_json` |
| SR-09 | integração | pesquisa concluída | persiste `type=RESEARCH`, `status=PENDING_RELEASE`, `sources[]` |
| SR-10 | integração | pílula enviada | NÃO contém o resumo (anti-textão); só "já pesquisei, é só pedir" |
| SR-11 | unit | guarda de cota | contador de uso incrementa por query |
| SR-12 | e2e | dúvida no WhatsApp | pílula → (F1.7) "manda" → resumo Feynman com fontes |

## Stories / tarefas

- **P0 — Chave + wrapper Brave:** obter `BRAVE_API_KEY`, `search.ts::braveSearch` com timeout/429/erros; harness standalone.
- **P1 — Consolidação + worker:** `search-worker.ts` (Brave → extract tolerante → consolida → Gemini → persiste pendente → pílula). Reusa `extract.ts`/`summarize.ts`/`notify.ts`.
- **P2 — Persistência RESEARCH/PENDING:** colunas/tabela (alinhar com F1.5/F1.7); guardar fontes.
- **P3 — Registro + AGENTS.md + E2E:** tool registrada; intenção; E2E (com F1.7 pro release).
- **P4 — Guarda de cota + README:** contador de uso; doc.

## Open questions

- **Entregar com ou sem F1.7?** Proposto: **specar/entregar junto com F1.7** (o anti-textão é o ponto). Fallback (card direto, sem PENDING) só se o cronograma apertar — perde o diferencial.
- **Brave API key:** obter a chave do free tier (cadastro). Bloqueador leve do P0. Alternativa se Brave não liberar a tempo: a Decisão deixa "revisitável" — poderia cair p/ outro provedor (Tavily/SerpAPI/DuckDuckGo HTML), mas mantém Brave como default.
- **Quantas fontes abrir (N) e profundidade:** mais fontes = melhor resumo, mais lento/cota. Proposto N=5, abrir as 3 primeiras que extraírem. Medir latência no P1.
- **`knowledge_node` reuso vs tabela `research`:** colocar pesquisa na mesma tabela (com `type`) vs separada. Proposto: **reusar `knowledge_node`** com `type` + `status` + `sources jsonb` (migration incremental) — alinha com F1.5/F1.7 e evita duplicar a recuperação.
- **Citação das fontes no card:** o resumo deve listar as URLs usadas (confiabilidade) — sim. Definir formato curto no card de pesquisa.
