# Suíte de testes — LinkMind (F1.10)

> **Filosofia (origem: PRD `.specs/project/PROJECT.md` + specs de feature):**
> os testes são derivados do **comportamento exigido pelo PRD/spec**, NÃO do código atual.
> Eles servem de **guard / TDD** para guiar a implementação. Onde a feature já existe, o teste
> afirma o contrato da spec (e se o código divergir, o teste deve FALHAR e expor a divergência).
> Onde a feature ainda não foi implementada (F1.3 YouTube, F1.6 Brave, F1.7 release loop),
> o teste define o contrato-alvo e fica **RED** até a implementação existir.

## Como rodar

```bash
cd tools/knowledge
bun test                 # tudo (precisa do pgserve no ar para a trilha de integração)
bun test tests/unit      # só unit puros + mock de externos (offline, gate rápido)
bun test --coverage      # baseline de cobertura
```

A trilha `tests/unit` é **offline** (sem rede, sem Gemini, sem WhatsApp, sem DB) — é a parte
que entra no `make verify` da F1.9. A trilha `tests/integration` exige o pgserve vivo e usa um
**DB descartável** (`linkmind_test`), nunca o `linkmind` real.

## Regras de ouro

- **Determinístico → `bun test`.** LLM/intenção/injection (F1.1, F1.8) ficam em eval próprio, fora daqui.
- **Mocka o caro, testa o nosso código.** Gemini (~140s), `fetch`, `omni send`, YouTube são mockados.
  Nunca se testa a qualidade do resumo da IA — só o código determinístico ao redor.
- **Fixtures versionadas** em `tests/fixtures/` (HTML de artigo, saídas de Gemini válidas/inválidas).
- **Integração isola o DB:** schema/DB de teste + seed + teardown limpo (`afterEach`/`afterAll`).

## Layout

```
tests/
  fixtures/      # HTML de artigo, gemini-valid.json, gemini-garbage.txt, etc.
  unit/          # offline: parsers, validações, mapa de erros, formatação (com mock de externos)
  integration/   # DB de teste (linkmind_test): recall, reminder, release SKIP LOCKED
  db-helper.ts   # cria/migra/limpa o DB de teste
```

## Mapa de IDs (das specs de feature)

- **F1.2** (extract): validação de URL, `no_content`, `http_error:<status>`, `unsupported_content_type:*`, `too_large`, `timeout`.
- **F1.3** YT-01..05/10/12: parse de `videoId` (todas as formas de URL + inválidas).
- **F1.4** (summarize/notify): `extractJson`, `CardSchema`, `gemini_bad_json` após retry, `formatCard`/`formatConfirmation`.
- **F1.6** SR-01..04/08/11: `braveSearch` (mock HTTP, rate limit, erro HTTP).
- **F1.7** RL-01..09: release `FOR UPDATE SKIP LOCKED` (concorrência determinística).
- **recall/reminder**: `findSummaries`/`findArticleForQA`/`markRecalled`, varredura `DISTINCT ON (chat)`.
