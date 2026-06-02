# F1.10 — Testes automatizados (suíte `bun test`)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa) — feature transversal (qualidade).
**Status:** 📝 SPEC (2026-06-02) — não iniciada. **Hoje a cobertura é ZERO** (nenhum `*.test.ts`).
**Depende de:** o código já existente das tools (F1.2, F1.4, recuperação, reminder) — todos com lógica testável já escrita ✅ · pgserve (testes de integração com DB) ✅.
**Habilita:** o **critério de avaliação explícito "Testes automatizados"** (hoje o ponto mais fraco do projeto) + rede de segurança anti-regressão pros refactors do M1.

> **Origem:** não é uma feature do ROADMAP — é uma lacuna transversal levantada no diagnóstico
> de 2026-06-02. Promovida a spec própria (F1.10) por ser um critério de banca direto e por o
> projeto inteiro ter sido validado só manualmente (standalone/E2E), sem regressão automática.

## Goal

Estabelecer uma suíte `bun test` que cubra a **lógica determinística** das tools (parsers,
validações, mapeamento de erros, queries de recuperação) com **mocks dos lentos/externos**
(Gemini, `fetch`, `omni`, YouTube), e uma camada fina de **integração com Postgres** num schema
descartável. Meta de cobertura pragmática nas unidades puras, e um `bun test` verde que vira
gate (e parte do `make verify` da F1.9).

## Filosofia: testar o determinístico, mockar o caro

O valor está nas peças **puras/determinísticas** que já têm bugs históricos conhecidos (parse
de JSON do Gemini, `jsonb` que volta string, PATH do detached). Os externos (Gemini ~140s,
rede, WhatsApp) são **mockados** — não se testa a IA, testa-se **o nosso código ao redor dela**.

| Camada | O quê | Como |
|---|---|---|
| **Unit (puro)** | `extractJson`/`CardSchema` (summarize), parse de `videoId` (F1.3), validação de URL (extract/server), `formatCard`/`formatConfirmation` (notify), mapa de erros | `bun test`, sem rede, fixtures locais |
| **Unit (mock externo)** | `extractArticle` (fixture HTML, `fetch` mockado), `summarizeFeynman` (mock do `runGemini`), `braveSearch` (F1.6, mock HTTP) | injeção de dep / mock de `fetch`/spawn |
| **Integração (DB)** | `findSummaries`/`findArticleForQA`/`markRecalled` (recall), reminder query, release `SKIP LOCKED` (F1.7) | schema de teste no pgserve, seed + assert + teardown |
| **Eval (separado)** | intenção (F1.1), injection (F1.8) | harness próprio das specs — não no `bun test` padrão (são lentos/LLM) |

## Scope

**In:**
1. **Unit puros** (maior ROI, começar aqui):
   - `summarize.test.ts`: `extractJson` (JSON cru, com cercas ```json, com prefácio/epílogo, lixo → throw), `CardSchema` (válido, faltando `pilares`, `pilares` vazio).
   - `notify.test.ts`: `formatCard`/`formatConfirmation` (card completo, campos faltando, escaping).
   - `youtube.test.ts` (quando F1.3): parse de `videoId` p/ todas as formas de URL + inválidas.
   - validação de URL: `archiveLink`/`extractArticle` rejeitam não-http, aceitam http(s).
2. **Unit com mock externo:**
   - `extract.test.ts`: HTML fixture → `extractArticle` extrai título/texto; HTML vazio → `no_content`; `fetch` mockado p/ 404/timeout/content-type errado → erros certos. _(Refator leve: permitir injetar o `fetch` ou usar `mock.module`.)_
   - `summarize.test.ts` (mock `runGemini`): Gemini devolvendo JSON válido → `ok`; devolvendo lixo 2× → `gemini_bad_json` após retry.
3. **Integração DB:**
   - Setup: criar um **schema/DB de teste** (ex.: `linkmind_test`) ou rodar cada teste numa transação com rollback. `recall.test.ts`: seed de nodes → `findSummaries` casa por ILIKE/ordena por data; `findArticleForQA` distingue `ok`/`no_content`/`not_found`; `markRecalled` zera o ciclo.
   - `reminder.test.ts`: nodes com idades/recalled variados → a varredura elege os certos (`DISTINCT ON (chat)`, ≥N dias, não-lidos).
4. **Infra de teste:** `bun test` configurado; helper de DB de teste (cria/limpa); fixtures em `tests/fixtures/`; doc curto de como rodar (vai pro README/`make verify`).
5. Integrar no **`make verify`** (F1.9): `bun test` faz parte do smoke (a parte que não precisa da stack viva).

**Out:**
- Testar a qualidade do resumo da IA (não-determinístico) — fora; só o código ao redor.
- Evals de intenção (F1.1) e injection (F1.8) — vivem nas suas specs (harness próprio, lentos).
- E2E real pelo WhatsApp — continua manual (a stack viva não roda em CI).
- 100% de cobertura — meta é o determinístico de valor, não número vaidoso.

## Definition of Done

- [ ] `bun test` roda e passa na raiz (ou por tool) com a suíte unit pura cobrindo `extractJson`, `CardSchema`, `formatCard`/`formatConfirmation`, validação de URL.
- [ ] `extract.ts` e `summarize.ts` testados com **externos mockados** (fetch / runGemini), cobrindo os caminhos de erro conhecidos (`no_content`, `http_error`, `gemini_bad_json`).
- [ ] Camada de integração DB: `recall`/`reminder` testados contra um DB/transação de teste, com seed e teardown limpos (não suja o `linkmind` real).
- [ ] Fixtures versionadas em `tests/fixtures/` (HTML de artigo, saídas de Gemini válidas/inválidas).
- [ ] `bun test` integrado ao `make verify` (parte offline) e documentado.
- [ ] Cobertura medida (`bun test --coverage`) e o número registrado no `STATE.md` como baseline (sem meta dogmática; foco nas unidades de valor).

## Design

### Padrão de mock (Bun)

- **`fetch`:** `mock.module` ou injeção — em `extract.ts`, permitir um `fetch` injetável (default global) p/ o teste fornecer `Response` fake (HTML fixture, status, headers). Refator mínimo, não muda comportamento.
- **`runGemini`:** hoje é função interna de `summarize.ts`. Extrair p/ permitir mock (ou exportar e usar `spyOn`). `summarizeFeynman` passa a ser testável sem chamar o Gemini real.
- **`omni`/`sendWhatsApp`:** mockar o spawn do `omni` — asserir que foi chamado com `(to, text)` certos, sem enviar nada.

### DB de teste

Opção A (proposta): **DB `linkmind_test`** separado, migrations aplicadas no setup global
(`beforeAll`), cada teste limpa suas linhas (`afterEach` TRUNCATE) — simples e robusto no
pgserve socket-trust. Opção B: transação por teste com rollback (mais rápido, mais chato com
`Bun.sql`). Decidir no P2.

### Estrutura

```
tests/
  fixtures/
    article-sample.html
    gemini-valid.json
    gemini-garbage.txt
  unit/        summarize.test.ts  notify.test.ts  extract.test.ts ...
  integration/ recall.test.ts  reminder.test.ts ...
  db-helper.ts
```

## Validação

1. `bun test` verde local.
2. Introduzir um bug proposital (ex.: quebrar `extractJson`) → teste correspondente falha (prova que pega regressão).
3. `make verify` roda a parte offline da suíte.
4. Coverage report gerado; baseline anotado.

## Mapa de Test Cases (origem nas specs das features)

Cada feature enumera seus test cases com ID na própria spec (seção `## Test Cases`). Esta
feature define **onde cada um roda** — não os reescreve. Três trilhas:

| Trilha | Comando | Cobre | IDs (das specs) |
|---|---|---|---|
| **`bun test`** (gate rápido, offline) | `make test` | unit puros + mock de externos + integração DB | YT-01..05/10/12 · SR-01..04/08/11 · RL-01..09 · VF-08 (parte) · casos puros de F1.2/F1.4 já existentes (extractJson, CardSchema, validação de URL, formatCard) |
| **eval harness** (lento, LLM, sob demanda) | `make eval` | classificação de intenção + injection | IC-01..14 (F1.1) · INJ-01..11 (F1.8) |
| **E2E manual** (stack viva, WhatsApp) | runbook | fluxo real ponta-a-ponta | YT-11 · SR-12 · RL-11 · INJ-05 · os E2E de F1.4/recuperação já validados |
| **smoke** (`make verify`, F1.9) | `make verify` | serviços + DB + pipeline determinístico | VF-01..12 + roda a trilha `bun test` offline |

**Regra de ouro:** o que é **determinístico** vai pra `bun test` (trilha 1); o que depende de
**LLM** vai pro eval (trilha 2, fora do gate rápido porque é caro/variável); o que precisa da
**stack viva** fica manual (trilha 3). F1.7 é exceção feliz: a concorrência (`SKIP LOCKED`) é
determinística → `bun test` de integração (RL-01..09), só o E2E de WhatsApp (RL-11) é manual.

## Stories / tarefas

- **P0 — Infra + unit puros:** configurar `bun test`; `summarize.test.ts` (extractJson/CardSchema) + `notify.test.ts`. Maior ROI, zero dependência externa.
- **P1 — Mock de externos:** tornar `fetch`/`runGemini` mockáveis (refator mínimo); `extract.test.ts` + caminhos de erro do `summarize`.
- **P2 — Integração DB:** `db-helper` (DB de teste) + `recall.test.ts` + `reminder.test.ts`.
- **P3 — Fixtures + coverage + `make verify`:** versionar fixtures; `--coverage` baseline; plugar no smoke offline da F1.9.

## Open questions

- **Onde roda `bun test`** — uma suíte na raiz cruzando os `tools/*` (cada um com `node_modules` isolado) pode atritar com resolução de deps. Alternativa: `bun test` **por tool** (`tools/knowledge`, `tools/fetch-web-content`) agregados por um script. Proposto: **por tool**, agregados no `make test`/`make verify`. Resolver no P0.
- **DB de teste vs rollback** — A (`linkmind_test` + truncate) vs B (transação/rollback). Proposto A. Confirmar no P2.
- **Refator p/ testabilidade** — `extract.ts`/`summarize.ts` precisam de pequenas costuras (fetch/runGemini injetáveis). É refator de baixo risco mas mexe em código validado; fazer com cuidado (comportamento idêntico). OK?
- **Evals (F1.1/F1.8) no mesmo `bun test`?** Proposto **não** — são lentos e LLM-dependentes; ficam em `tests/*-eval.ts` rodados sob demanda (`make eval`), fora do gate rápido.
