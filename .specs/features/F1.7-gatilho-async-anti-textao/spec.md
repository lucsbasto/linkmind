# F1.7 — Gatilho async anti-textão (release sob comando)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 📝 SPEC (2026-06-02) — não iniciada.
**Depende de:** F1.4 (worker assíncrono + persistência) ✅ · **F1.6** (produz o conteúdo pendente de pesquisa que esta feature libera — par natural) 📝 · F1.1 (roteia o gatilho "pode mandar" → `release_pending`) 📝 · pgserve/autopg (precisa de `FOR UPDATE SKIP LOCKED`) ✅.
**Habilita:** o **anti-textão** prometido no PROJECT ("texto denso só vai ao chat sob comando explícito") e o requisito de **resiliência transacional** do PRD ("zero perda/duplicação mesmo com queda do servidor").

> **Origem:** ROADMAP F1.7 — "Resumo de pesquisa salvo com status `PENDING_RELEASE`; notificação curta 'Já pesquisei, é só pedir'; loop de release com `FOR UPDATE SKIP LOCKED` quando o usuário envia o gatilho." É o único lugar do roadmap que exige explicitamente concorrência transacional.

## Goal

Implementar o **mecanismo de liberação sob demanda**: conteúdo denso (resultado de pesquisa
F1.6, e potencialmente cards longos) fica **retido** com status `PENDING_RELEASE`; o usuário
recebe só uma **pílula curta**; ao mandar um **gatilho** ("pode mandar", "manda", "manda o
texto"), o texto retido é entregue — exatamente uma vez, com segurança sob concorrência
(`FOR UPDATE SKIP LOCKED`), sobrevivendo a quedas do servidor sem perder nem duplicar.

## Por que transacional (o ponto técnico do diferencial)

Dois turnos podem disparar o release "ao mesmo tempo" (usuário manda "manda" 2×, ou um retry
do bridge). Sem trava, o mesmo conteúdo vai 2× (duplicação) ou 0× (perda numa corrida). O
padrão Postgres canônico:

```sql
-- pega o(s) pendente(s) do chat, TRAVANDO a linha e pulando o que já está travado
-- por outra transação concorrente; marca como liberado na MESMA transação.
WITH proximo AS (
  SELECT id FROM knowledge_node
  WHERE chat = $1 AND status = 'PENDING_RELEASE'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE knowledge_node k SET status = 'RELEASED', released_at = now()
FROM proximo WHERE k.id = proximo.id
RETURNING k.id, k.card, k.url, k.title;
```

A transição `PENDING_RELEASE → RELEASED` e a leitura do conteúdo acontecem **atômicas**: a
linha só é marcada liberada se esta transação a pegou; concorrentes pulam (`SKIP LOCKED`).
Se o envio ao WhatsApp falhar **depois** do commit, a linha já está `RELEASED` → não reenviar
(idempotente do lado do release); o reenvio vira responsabilidade de um retry explícito (ver
Open questions). **Crash entre commit e envio = no máximo 1 mensagem perdida, nunca duplicada**
— trade-off aceito p/ o MVP (alternativa "outbox" anotada).

## Scope

**In:**
1. **Schema:** estado de liberação no `knowledge_node` (ou tabela `pending_message`): `status` (`PENDING_RELEASE`|`RELEASED`), `released_at`, e o tipo do conteúdo (`type` RESEARCH|LINK|...). Migration incremental idempotente (segue o padrão de `migrations/00x_*.sql`).
2. **Produção de pendente:** helper `enqueuePending(chat, card, ...)` usado pela F1.6 (e por quem mais quiser reter) → grava `PENDING_RELEASE` + manda a **pílula curta** ("🔎 já pesquisei sobre *X*, manda 'pode mandar' que te envio").
3. **Release transacional:** `releasePending(chat)` com o `WITH ... FOR UPDATE SKIP LOCKED` acima; libera **1 pendente por vez** (o mais antigo) e o envia via `notify.sendWhatsApp`; se houver mais, avisa quantos restam.
4. **Detecção do gatilho:** intenção `LIBERAR_PENDENTE` (F1.1) → tool `release_pending(chat)` (server `knowledge`). Reconhecer variações ("pode mandar", "manda", "manda aí", "quero ver", "manda o texto").
5. **Tool registrada** + `AGENTS.md` (gatilho → `release_pending`; se `found:0`, "não tem nada pendente pra te mandar").
6. **Teste de resiliência:** derrubar o pgserve/processo durante uma carga de releases concorrentes e provar 0 duplicação / ≤ tolerado de perda (validação do Goal do PROJECT).

**Out:**
- Geração do conteúdo de pesquisa = F1.6 (aqui só o ciclo reter→liberar).
- Roteamento da intenção = F1.1.
- Outbox/at-least-once com reentrega garantida — v1 é at-most-once no envio pós-commit (ver Open questions); upgrade anotado.
- Expiração de pendentes (TTL) — anotar como ideia.

## Definition of Done

- [ ] Migration incremental: `status`/`released_at`/`type` (ou tabela `pending_message`), idempotente, índice parcial em pendentes por `chat`.
- [ ] `enqueuePending(...)` grava `PENDING_RELEASE` + dispara a pílula curta (sem o conteúdo denso).
- [ ] `releasePending(chat)` usa `FOR UPDATE SKIP LOCKED`, libera o mais antigo, marca `RELEASED` na mesma transação, envia o conteúdo; reporta `{released, remaining}`.
- [ ] `release_pending(chat)` registrada + `AGENTS.md` (gatilho + variações; `found:0` → aviso curto).
- [ ] **Concorrência provada:** disparar N releases simultâneos pro mesmo chat → cada pendente sai **exatamente uma vez** (0 duplicação), confirmado por contagem no DB.
- [ ] **Resiliência provada:** matar o processo durante a carga → ao reerguer, nenhum `RELEASED` foi reenviado, nenhum `PENDING` virou inconsistente.
- [ ] **E2E WhatsApp:** (com F1.6) dúvida → pílula → "pode mandar" → texto liberado; "pode mandar" de novo → "não tem mais nada pendente".

## Design

### Estado no `knowledge_node`

```sql
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'RELEASED';
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'LINK';
CREATE INDEX IF NOT EXISTS idx_pending ON knowledge_node (chat, created_at)
  WHERE status = 'PENDING_RELEASE';
```

Nodes de arquivamento normal (F1.4) nascem `RELEASED` (default) → não afetados. Só pesquisa
(F1.6) nasce `PENDING_RELEASE`. _(Alternativa: tabela `pending_message` separada se misturar
poluir a recuperação por assunto — decidir na Open question.)_

### `releasePending` (Bun.sql, transação explícita)

Rodar o `WITH ... FOR UPDATE SKIP LOCKED ... UPDATE ... RETURNING` numa transação; com a linha
retornada, `notify.sendWhatsApp(chat, formatCard(...))`. `Bun.sql` suporta `db.begin(...)`.
1 por chamada (anti-flood); `remaining` = contagem de pendentes restantes.

### Gatilho

Variações no `AGENTS.md`: "pode mandar", "manda", "manda aí/isso/o texto/o resumo completo",
"quero ver". Cuidado de desempate (F1.1): "me manda o resumo de X" (com assunto) = `send_summary`,
NÃO release. "manda" **sem** assunto, havendo pendente = `release_pending`.

## Validação

1. **Unit (transacional):** dois `releasePending(chat)` concorrentes sobre 1 pendente → um devolve a linha, o outro `found:0`. (Teste com 2 conexões.)
2. **Carga:** 10 pendentes, 20 releases concorrentes → exatamente 10 entregas, 0 duplicada.
3. **Crash:** `kill -9` no meio → reerguer → invariantes mantidas (nenhum RELEASED reenviado).
4. **E2E:** fluxo pílula → gatilho → liberação no WhatsApp.

## Test Cases

| ID | Tipo | Cenário | Esperado |
|---|---|---|---|
| RL-01 | integração (2 conexões) | 2 `releasePending(chat)` concorrentes, **1** pendente | um devolve a linha, o outro `found:0` (0 duplicação) |
| RL-02 | integração (carga) | 10 pendentes, 20 releases concorrentes | exatamente 10 entregas, 0 duplicada |
| RL-03 | integração | release de 1 pendente | `PENDING_RELEASE→RELEASED` na mesma transação (`RETURNING`) |
| RL-04 | integração | `releasePending(chat)` sem pendente | `found:0` → "não tem nada pendente" |
| RL-05 | integração | 3 pendentes, 1 release | libera o **mais antigo**, reporta `remaining:2` |
| RL-06 | resiliência | `kill -9` no meio da carga | reerguer: nenhum `RELEASED` reenviado, nenhum `PENDING` inconsistente |
| RL-07 | integração | `enqueuePending(...)` | grava `PENDING_RELEASE` + dispara pílula **sem** o conteúdo denso |
| RL-08 | integração | node de arquivamento normal (F1.4) | nasce `RELEASED` (default), não vira pendente |
| RL-09 | integração | `findSummaries`/`reminder` com pesquisa pendente no DB | filtram `status='RELEASED'` (pendente não vaza na recuperação/nudge) |
| RL-10 | eval (F1.1) | "me manda o resumo de X" vs "manda" (sem assunto, há pendente) | `send_summary` vs `release_pending` (desempate) |
| RL-11 | e2e | pílula → "pode mandar" → texto; "pode mandar" de novo | 1º libera; 2º "não tem mais nada pendente" |

## Stories / tarefas

- **P0 — Migration + invariantes:** colunas/índice; nodes normais seguem `RELEASED`.
- **P1 — `enqueuePending` + pílula:** API de retenção + notificação curta (reusa `notify.ts`).
- **P2 — `releasePending` transacional:** `FOR UPDATE SKIP LOCKED` + envio + `{released,remaining}`; testes de concorrência (2 conexões).
- **P3 — Tool + AGENTS.md + desempate do gatilho:** registrar; variações; vs `send_summary`.
- **P4 — Teste de resiliência + E2E:** derrubada manual sob carga; E2E com F1.6.

## Open questions

- **At-most-once vs outbox (at-least-once):** v1 marca `RELEASED` e envia depois do commit → crash entre os dois perde 1 msg (nunca duplica). Upgrade = padrão **outbox** (linha `RELEASED` + flag `delivered_at`; um varredor reenvia não-entregues). Proposto: **at-most-once no v1**, outbox anotado — o requisito do PRD é "zero duplicação", que o `SKIP LOCKED` já garante; perda-em-crash-raro é tolerável no MVP local.
- **Mesma tabela vs `pending_message`:** reusar `knowledge_node` (com `status`/`type`) é mais simples e alinha recuperação; risco = pesquisa pendente aparecer em `send_summary`/reminder. Mitigar: `findSummaries`/`reminder.ts` filtram `status='RELEASED'`. Proposto: **mesma tabela + filtros** (anotar o ajuste nas queries existentes).
- **1 por gatilho vs todos:** liberar 1 (anti-flood, com "restam N") vs despejar todos. Proposto: **1 por vez** (anti-textão até no release). Confirmar.
- **TTL de pendente:** pesquisa que ninguém pediu fica pra sempre? Proposto: sem TTL no v1; ideia futura (ou o reminder cobre).
- **Conexão p/ transação:** `Bun.sql` `db.begin()` sobre o socket unix trust — validar que o `SKIP LOCKED` funciona como esperado nesse setup (provável que sim; confirmar no P2).
