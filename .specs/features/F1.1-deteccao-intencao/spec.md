# F1.1 — Detecção dinâmica de intenção (roteamento)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 📝 SPEC (2026-06-02) — não iniciada.
**Depende de:** F0.2 (agente + AGENTS.md como roteador) ✅ · F1.2/F1.4 (tools de captura/arquivo, alvos do roteamento) ✅ · **F1.6** (a rota DÚVIDA→pesquisa só tem ação real quando `search_web_knowledge` existir — ver "Dependência parcial").
**Habilita:** comportamento confiável de "manda qualquer coisa que o LinkMind faz a coisa certa" — pré-requisito de uma demo robusta e do critério ≥95% do ROADMAP.

> **Origem:** ROADMAP F1.1 — "Classificador (LLM-based) que decide LINK_PARA_ARQUIVAR | DUVIDA_PARA_PESQUISAR | OUTRO; roteamento ao pipeline correto; precisão ≥95% em 50 mensagens-fixture."

## Tensão central (qual é a feature, de verdade)

Hoje o roteamento **já acontece** — mas é **implícito**, embutido no `AGENTS.md`: o engine
`claude` lê as instruções e escolhe a tool (`archive_link` p/ link, `fetch_web_content` p/
"lê na hora", `send_summary`/`ask_article` p/ recuperar). Não há um classificador separado
nem **nenhuma medição** de quão certo ele acerta.

Duas leituras possíveis da F1.1:

- **(A) Classificador determinístico pré-turno** — um passo antes do agente que rotula a
  mensagem e força o pipeline. Custo: duplica a inteligência que o agente já tem, adiciona
  latência, e o engine é o `claude` spawnado pelo bridge (não temos um "pré-hook" natural no
  caminho do bridge sem reescrever a integração).
- **(B) Formalizar + medir o roteamento que já existe** — tratar o `AGENTS.md` como o
  classificador, **endurecer** suas regras de decisão (incluindo casos ambíguos), e construir
  um **harness de avaliação** com 50 fixtures que mede a precisão e vira gate de regressão.

**Decisão proposta (a confirmar — ver Open questions): (B) como v1**, com a porta aberta
pra (A) só se a medição mostrar que o prompt não chega a ≥95%. Motivo: respeita a arquitetura
real (o agente JÁ roteia), entrega o que falta de fato (regras explícitas dos casos
ambíguos + **número** de precisão), e não acopla um segundo cérebro redundante.

## Goal

Garantir que **qualquer mensagem** do usuário cai no pipeline certo, com **roteamento
explícito e medido**: regras de decisão claras no `AGENTS.md` cobrindo os casos ambíguos, e
um harness de avaliação com ≥50 fixtures provando ≥95% de acerto — repetível a cada mudança
de prompt/tool (gate anti-regressão).

## Taxonomia de intenções (v1)

| Rótulo | Gatilho | Ação (tool) |
|---|---|---|
| `ARQUIVAR_LINK` | mensagem contém URL http(s) "pra guardar" | `archive_link(url, chat)` |
| `LER_NA_HORA` | URL + "lê e me fala rapidinho / o que é isso" | `fetch_web_content(url)` |
| `RECUPERAR_RESUMO` | "me manda/lembra o resumo de X", "o que salvei sobre X" | `send_summary(assunto, chat)` |
| `PERGUNTAR_ARTIGO` | pergunta específica sobre artigo salvo ("qual o pseudocódigo do artigo") | `ask_article(pergunta, assunto?, chat)` |
| `DUVIDA_PESQUISAR` | pergunta factual sem artigo salvo correspondente ("qual a capital de X", "como funciona Y") | `search_web_knowledge(query, chat)` **(F1.6 — ainda não existe)** |
| `LIBERAR_PENDENTE` | "pode mandar", "manda", "manda o texto" | `release_pending(chat)` **(F1.7 — ainda não existe)** |
| `OUTRO` | conversa/saudação/fora de escopo PKM | responder curto, sem tool (ou recusar — ver F1.8) |

## Dependência parcial

A **classificação** das 7 intenções é independente e specável/testável agora. Mas duas
**ações** ainda não existem: `DUVIDA_PESQUISAR` (precisa F1.6) e `LIBERAR_PENDENTE` (precisa
F1.7). v1 da F1.1 pode: (a) classificar tudo já, e (b) pras rotas sem ação ainda, responder
"isso ainda não tá pronto" (1 linha, anti-alucinação — já é a regra do `AGENTS.md` p/ YouTube/
pesquisa). Quando F1.6/F1.7 entrarem, é só plugar a tool na rota já classificada.

## Scope

**In:**
1. Seção de roteamento explícita no `AGENTS.md`: a tabela acima + **regras de desempate** dos casos ambíguos (ver Design).
2. **Fixture set** `tests/fixtures/intent/*.jsonl` — ≥50 mensagens reais/sintéticas, cada uma com `{ mensagem, chat, esperado: <rótulo> }`. Cobrir: links com/sem texto, perguntas sobre salvos vs. factuais, gatilhos de liberação, saudações, mensagens fora de escopo, e **ambíguos** (link + pergunta na mesma msg; "manda o resumo" sem dizer de quê).
3. **Harness de avaliação** `tests/intent-eval.ts` — roda cada fixture pelo classificador e reporta precisão por rótulo + matriz de confusão + lista de erros. Modo barato (classificador isolado) e modo E2E opcional.
4. Iteração do prompt até **≥95%** agregado e **0 erros graves** (ex.: arquivar quando era pergunta, ou vazar dado quando era OUTRO).

**Out:**
- Implementar `search_web_knowledge` (F1.6) e `release_pending` (F1.7) — aqui só roteamos pra elas.
- Multi-intenção numa mensagem (ex.: arquivar 2 links de uma vez) — anotar como ideia; v1 trata a 1ª intenção dominante.
- Memória de contexto multi-turno pro roteamento (ex.: "e o outro?") — F2/ideia.

## Design

### Onde mora o classificador

`AGENTS.md` (lido pelo `claude` via `--append-system-prompt-file`). Adicionar um bloco
`<roteamento>` com a tabela + as regras de desempate. **Não** criar pré-hook no bridge (v1).

### Regras de desempate (os casos que erram)

- **URL + pergunta na mesma msg** ("o que esse link diz sobre X?") → `LER_NA_HORA` (resposta
  imediata), NÃO `ARQUIVAR_LINK`. Guardar só se ele disser "guarda/salva".
- **"me manda o resumo" sem assunto** → pedir o assunto em 1 linha (não chutar) OU mandar o
  mais recente — decisão: **perguntar** ("de qual? me dá o tema") p/ não mandar errado.
- **Pergunta que PODE ser sobre artigo salvo vs. factual** → se citar um tema que provavelmente
  está salvo, `PERGUNTAR_ARTIGO`; se for conhecimento geral do mundo, `DUVIDA_PESQUISAR`. Na
  dúvida, `PERGUNTAR_ARTIGO` primeiro (barato, já temos os dados) e cair pra pesquisa se
  `not_found`.
- **Saudação / "obrigado" / fora de escopo** → `OUTRO`, resposta curta, sem tool.

### Harness de avaliação (opção B — barato)

Como medir sem rodar o bridge inteiro 50×? Duas estratégias (escolher na Open question):
- **B1 — classificador-espelho via Gemini:** um `classify_intent(msg)` standalone (mesmo
  motor `gemini -p` já usado, prompt = as regras do `AGENTS.md`) que devolve só o rótulo. O
  eval bate nele direto. Rápido/barato/determinístico-o-suficiente; risco = não é byte-a-byte
  o mesmo engine do agente (claude), então a precisão medida é uma **proxy**.
- **B2 — E2E real (amostra):** rodar um subconjunto (~10) pelo WhatsApp/bridge e conferir a
  tool chamada no `genie agent log`. Caro/lento; serve de calibração da proxy.

Proposto: **B1 como gate contínuo** + **B2 como calibração pontual** (rodar uma vez, anotar
o gap proxy-vs-real no `STATE.md`).

### Formato do fixture (`tests/fixtures/intent/casos.jsonl`)

```jsonl
{"id":"link-guardar","msg":"guarda esse https://ex.com/post","esperado":"ARQUIVAR_LINK"}
{"id":"link-lehora","msg":"o que diz esse https://ex.com/post?","esperado":"LER_NA_HORA"}
{"id":"recupera","msg":"me manda o resumo de useEffect","esperado":"RECUPERAR_RESUMO"}
{"id":"pergunta-artigo","msg":"qual o pseudocódigo do artigo de skills?","esperado":"PERGUNTAR_ARTIGO"}
{"id":"duvida","msg":"como funciona o protocolo MCP?","esperado":"DUVIDA_PESQUISAR"}
{"id":"libera","msg":"pode mandar","esperado":"LIBERAR_PENDENTE"}
{"id":"outro","msg":"valeu, bom dia!","esperado":"OUTRO"}
```

## Definition of Done

- [ ] `AGENTS.md` com bloco de roteamento explícito (tabela das 7 intenções + regras de desempate dos ambíguos).
- [ ] ≥50 fixtures em `tests/fixtures/intent/`, cobrindo todos os rótulos + ≥10 casos ambíguos.
- [ ] `tests/intent-eval.ts` roda os fixtures, imprime precisão agregada + por rótulo + matriz de confusão + lista de falhas; sai ≠0 se < meta.
- [ ] **Precisão ≥95% agregada** e **0 erros graves** (arquivar↔pergunta, ou tool de ação quando era OUTRO).
- [ ] Calibração B2: ~10 casos rodados E2E real, gap proxy-vs-real anotado no `STATE.md`.
- [ ] Rotas sem ação ainda (`DUVIDA_PESQUISAR`, `LIBERAR_PENDENTE`) respondem "ainda não tá pronto" em 1 linha (não alucinam).

## Validação

1. **Eval verde:** `bun run tests/intent-eval.ts` → ≥95%, 0 graves.
2. **Regressão:** mudar uma regra do prompt e rever o número (gate).
3. **Ambíguos:** os 10 casos difíceis classificam como decidido nas regras de desempate.
4. **Anti-alucinação:** `DUVIDA_PESQUISAR`/`LIBERAR_PENDENTE` não fingem fazer o que não existe.

## Test Cases

Tipo: **eval** = roda pelo harness de classificação (`claude -p` headless / espelho Gemini); **e2e** = pelo bridge real. Cada caso vira ≥1 fixture em `tests/fixtures/intent/`.

| ID | Tipo | Cenário (mensagem) | Esperado |
|---|---|---|---|
| IC-01 | eval | "guarda esse https://ex.com/post" | `ARQUIVAR_LINK` → `archive_link` |
| IC-02 | eval | "o que diz esse https://ex.com/post?" | `LER_NA_HORA` → `fetch_web_content` (NÃO arquiva) |
| IC-03 | eval | "me manda o resumo de useEffect" | `RECUPERAR_RESUMO` → `send_summary(assunto)` |
| IC-04 | eval | "qual o pseudocódigo do artigo de skills?" | `PERGUNTAR_ARTIGO` → `ask_article` |
| IC-05 | eval | "como funciona o protocolo MCP?" (nada salvo) | `DUVIDA_PESQUISAR` |
| IC-06 | eval | "pode mandar" (há pendente) | `LIBERAR_PENDENTE` |
| IC-07 | eval | "valeu, bom dia!" | `OUTRO` (resposta curta, sem tool) |
| IC-08 | eval | **ambíguo:** "o que esse link diz sobre X? https://…" | `LER_NA_HORA` (não `ARQUIVAR_LINK`) |
| IC-09 | eval | **ambíguo:** "me manda o resumo" (sem assunto) | pedir o assunto em 1 linha (não chutar) |
| IC-10 | eval | **ambíguo:** pergunta que pode ser sobre salvo vs. factual | `PERGUNTAR_ARTIGO` 1º; fallback `DUVIDA_PESQUISAR` se `not_found` |
| IC-11 | eval | **métrica:** ≥50 fixtures agregados | precisão ≥95% |
| IC-12 | eval | **erro grave:** nenhum caso de pergunta vira `ARQUIVAR_LINK`, nenhum `OUTRO` dispara ação | 0 ocorrências |
| IC-13 | eval | rota sem ação ainda (`DUVIDA_PESQUISAR`/`LIBERAR_PENDENTE`, pré-F1.6/F1.7) | responde "ainda não tá pronto" (não alucina) |
| IC-14 | e2e | amostra ~10 casos pelo bridge real | tool chamada confere com o rótulo (calibração proxy↔real) |

## Stories / tarefas

- **P0 — Taxonomia + regras no AGENTS.md:** formalizar as 7 intenções e os desempates.
- **P1 — Fixtures:** montar os ≥50 casos (incluindo ambíguos e fora-de-escopo).
- **P2 — Harness B1:** `classify_intent` espelho (Gemini) + `intent-eval.ts` (métricas).
- **P3 — Iterar até ≥95%:** rodar, ler os erros, ajustar o prompt, repetir.
- **P4 — Calibração B2 + registro:** amostra E2E real, anotar gap no STATE.

## Open questions

- **A vs B (classificador separado vs prompt medido):** proposto **B**. Confirmar com o usuário — se a banca quiser ver um "classificador" explícito como artefato, B1 (`classify_intent` standalone) já entrega isso como peça testável sem virar pré-hook do bridge.
- **B1 proxy (gemini) vs engine real (claude):** a precisão medida é proxy. Aceitável p/ gate? Ou investir num caminho de medir o claude direto (print-mode `claude -p` com o mesmo AGENTS.md, fora do bridge)? → Proposto: medir pelo **`claude -p` headless com o mesmo system prompt** (mais fiel que o gemini-espelho e ainda barato), B2 só p/ confirmar o caminho do bridge.
- **"me manda o resumo" sem assunto:** perguntar de volta vs. mandar o mais recente. → Proposto: **perguntar** (1 linha) p/ não errar.
- **Multi-intenção:** v1 = só a dominante. Confirmar que é aceitável p/ o MVP.
