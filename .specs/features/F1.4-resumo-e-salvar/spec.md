# F1.4 — Resumo Feynman (Gemini CLI) + persistência (escrita)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 🚧 IN PROGRESS — P0 + P1 ✅ (2026-06-01); **redesenhada p/ assíncrona** (ack imediato + worker em background). Próximo: P2 (lib + worker + tool).
**Depende de:** F1.2 (`fetch_web_content` entrega o texto limpo) ✅ · F0.2 (tool harness) ✅ · Gemini CLI nativo Linux + OAuth headless ✅ (ver memória `linkmind-gemini-cli`) · autopg/pgserve em `127.0.0.1:5432` ✅
**Habilita:** **Feature de recuperação** ("me envia o link de tal assunto") — slice de leitura, próxima feature. F1.7 (gatilho async) reusa a mesma tabela.

> **Origem (pedido do usuário, 2026-06-01):** "quando eu pedir 'me envia o link de tal assunto', eu ter salvo — quero salvar o resumo também; usar o Gemini CLI pra criar esse resumo." Esta feature cobre **só a escrita** (capturar → resumir → salvar). A **leitura/recuperação** é a feature seguinte (decisão: escrita primeiro, validável isolada).

## Goal

Fechar o **caminho de escrita do arquivamento**: usuário manda um link no WhatsApp →
o agente captura o conteúdo (F1.2) → **gera um card Feynman via Gemini CLI** → **persiste**
(link + título + tópico + card) no Postgres. Resultado: o conhecimento fica salvo e
estruturado, pronto pra recuperação por tópico na feature seguinte.

## Decisões já tomadas (alinhadas com o usuário)

1. **Escopo = só escrita** agora (capturar + resumir + salvar). Recuperação vira feature 2.
2. **Resumo = Feynman estruturado em JSON** (Ideia Central / Pilares / Aplicação Prática) — o "card" assinatura do produto, não prosa solta.
3. **Persistência = tabela mínima única** (`knowledge_node`) agora; evolui pro schema completo (source/summary separados, tipos LINK|YOUTUBE|RESEARCH) quando a recuperação/cruzamento pedir (F1.5/F2.1).
4. **Motor do resumo = Gemini CLI** (shell-out `gemini -p`), NÃO o modelo do agente.

## Scope

**In:**
1. Nova tool `mcp__knowledge__archive_link(url)` — orquestra o pipeline de escrita **server-side** (uma chamada só, determinística): fetch → Gemini → persist.
2. Sumarização Feynman via Gemini CLI: monta prompt, chama `gemini -p`, **parseia + valida o JSON** retornado (zod), 1 retry se vier inválido.
3. Persistência em Postgres (autopg): migration da tabela `knowledge_node` + insert transacional.
4. Refator leve: extrair a lógica de fetch+extração da F1.2 para uma **lib compartilhada** (`tools/lib/extract.ts`) consumida pela F1.2 e por esta tool (evita duplicar/re-implementar).
5. Registro no agente (`.mcp.json` server `knowledge` + `permissions.allow`) **+ atualização do `AGENTS.md`** (tool nova exige, senão o agente recusa — ver memória `linkmind-nova-tool-checklist`).
6. Validação E2E pelo WhatsApp.

**Out (outras features / depois):**
- **Recuperação** "me envia o link de tal assunto" (próxima feature — leitura).
- Detecção de intenção / roteamento automático (F1.1) — aqui a tool é chamada quando o agente reconhece um link.
- YouTube (F1.3), Brave/pesquisa (F1.6), gatilho async anti-textão (F1.7).
- Schema Postgres completo com tabelas separadas + tipos + índices de cruzamento (F1.5/F2.1).
- Deduplicação por URL / re-arquivamento (anotar como ideia).

## Arquitetura: assíncrono (decisão do usuário, 2026-06-01)

Resumir é **lento** (Gemini: ~22s p/ 2k chars, >120s p/ 8k — latência cresce muito
com o tamanho). Bloquear o turno do agente por 1-2 min arrisca timeout do bridge /
órfão preso. Decisão: **fire-and-forget**.

- **Turno do agente (rápido):** `archive_link(url)` **valida a URL, dispara um worker
  desacoplado e retorna na hora** (`{ ok:true, status:"processing" }`). O agente
  responde um **ack curto** ("📥 Recebi! Tô resumindo e salvando, já te aviso — pode
  levar 1-2 min.") e fecha o turno.
- **Worker (background, sobrevive ao turno):** `setsid bun run worker.ts` → captura
  (F1.2) → resume (Gemini) → salva (`knowledge_node`) → **`omni send`/`omni say`**
  manda o card pro WhatsApp. Em erro, manda um aviso curto de falha.
- **Viável porque:** `omni send --to <número> --text` / `omni say --instance <id>
  --chat <id>` mandam mensagem **fora do turno**. **MVP single-user:** alvo do callback
  (instância + número) fica em config/env; multi-usuário (chat dinâmico) é depois.

## Definition of Done

- [x] Tabela `knowledge_node` criada no autopg via migration versionada (re-rodável). _(P0)_
- [x] `gemini -p` produz um card Feynman **JSON válido** a partir de um texto real, parseado e validado (zod). _(P1 — `summarize.ts`)_
- [ ] `archive_link(url)` (server `knowledge`) **dispara o worker e retorna em segundos** (`status:"processing"`), sem bloquear o turno.
- [ ] `worker.ts` (desacoplado, sobrevive ao fim do turno) faz captura → resumo → persist → **manda o card no WhatsApp via `omni`**; em erro, manda aviso curto.
- [ ] Erros tratados por etapa (captura / Gemini-JSON / DB / envio), com notificação ao usuário em vez de falha silenciosa.
- [ ] Tool registrada (`.mcp.json` server `knowledge` + `mcp__knowledge__archive_link` em `settings.local.json`) **e `AGENTS.md` atualizado**: ao receber link → ack curto + chamar `archive_link` (NÃO esperar o resumo no mesmo turno).
- [ ] **E2E WhatsApp:** mandar um link → ack imediato → `[C] mcp__knowledge__archive_link` no `genie agent log` → ~1-2 min depois chega o card → linha conferível em `knowledge_node`.
- [ ] README curto da tool em `tools/knowledge/`.

## Design

### Interface da tool (retorno imediato)

```ts
archive_link(url: string) -> {
  ok: boolean            // true = worker disparado; false = URL inválida (rejeita antes de disparar)
  status?: "processing"  // sinaliza ao agente que o resultado virá depois, por mensagem nova
  error?: string         // ex.: "invalid_url" — só quando ok=false
}
```

A tool **não** devolve o card — ela só valida a URL e dispara o worker. O agente, ao
ver `status:"processing"`, manda um **ack curto** e fecha o turno. O card chega depois,
numa mensagem nova enviada pelo worker.

### Pipeline assíncrono

**`archive_link` (no turno, rápido):** valida `url` (http/https) → `setsid bun run worker.ts <url>` desacoplado (não-await, sobrevive ao turno) → retorna `{ ok:true, status:"processing" }`.

**`worker.ts` (background):**
1. **Captura** — `extractArticle(url)` da lib compartilhada (= miolo da F1.2: fetch + UA + timeout + linkedom/Readability + limites).
2. **Resumo (Gemini)** — `summarizeFeynman(text)` (já feito no P1): prompt JSON estrito (`ideia_central`/`pilares[]`/`aplicacao`/`topico`), `gemini -p` via **stdin** (texto vai por stdin + `proc.stdin.end()` p/ fechar EOF — senão trava), só stdout, extrai+valida zod, 1 retry. `MAX_CHARS` ~4000 (latência cresce muito com tamanho).
3. **Persistência** — `INSERT` em `knowledge_node`, retorna `id`.
4. **Callback WhatsApp** — `omni send`/`omni say` com o card formatado (curto). Em erro de qualquer etapa, manda aviso curto ("não consegui resumir esse link: <motivo>").

### Stack

- `tools/knowledge/` = projeto Bun isolado (vide `tools/README.md`), MCP stdio server, `zod` no input/validação.
- **DB driver:** `Bun.sql` (Postgres nativo do Bun 1.3.x — já instalado) → sem dep extra. _(Fallback: lib `postgres` se `Bun.sql` atritar.)_
- **Gemini:** shell-out `gemini -p` (binário nativo `/usr/bin/gemini`, OAuth headless). Silenciar ruído (aviso ripgrep + `[ERROR] [IDEClient]`): ler só o stdout do resumo; se preciso, desligar `ide.enabled` no `~/.gemini/settings.json` ou flag headless.
- **Lib compartilhada:** `tools/lib/extract.ts` — F1.2 passa a importar daqui (refator sem mudar comportamento).

### Tabela `knowledge_node` (mínima)

```sql
CREATE TABLE IF NOT EXISTS knowledge_node (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url         text NOT NULL,
  title       text,
  topico      text,                 -- p/ recuperação por assunto
  card        jsonb NOT NULL,       -- { ideia_central, pilares[], aplicacao }
  summary_text text,                -- card achatado p/ display/busca rápida
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### Categorias de erro (`error`)

`capture_failed:<categoria F1.2>` | `gemini_failed:<motivo>` | `gemini_bad_json` (não validou após retry) | `db_failed:<motivo>`.

## Stories / tarefas

- **P0 — Conexão + migration:** ✅ **CONCLUÍDO (2026-06-01).** Conexão = **socket unix com trust** (sem senha): `new SQL({ path: "/run/user/1000/pgserve/.s.PGSQL.5432", username:"postgres", database:"linkmind", tls:false })` — a forma `hostname`+`port` dá "Connection closed" (TLS). Helper em `tools/knowledge/db.ts` (socket/DB/user overridáveis por env p/ portabilidade). Database `linkmind` criado; migration `migrations/001_knowledge_node.sql` aplicada via `tools/knowledge/migrate.ts` (idempotente, re-rodável). INSERT/SELECT/DELETE validados. **Quirk:** `Bun.sql` devolve `jsonb` como **string** → `JSON.parse(row.card)` ao ler. **Nota:** o Postgres do **Omni** é outro (`localhost:8432/omni`) — não usar; LinkMind usa o autopg 5432.
- **P1 — Sumarização Gemini:** ✅ **CONCLUÍDO (2026-06-01).** `tools/knowledge/summarize.ts` (`summarizeFeynman(text)`): prompt JSON estrito + `gemini -p` via **stdin** + extração/validação zod + 1 retry; `stderr:"ignore"` silencia ruído. **Bug corrigido:** stdin como `Uint8Array` travava o gemini (não fechava EOF) → trocado por `proc.stdin.write()` + `await proc.stdin.end()`. Validado com artigo real (Wikipedia/Feynman, 2k chars → card coerente em ~22s). **Latência:** 2k≈22s, 8k>120s (cresce muito) → `MAX_CHARS` baixado p/ ~4000; é o que motivou o desenho **assíncrono** (ver seção Arquitetura).
- **P2 — Refator lib + worker + tool `archive_link` (assíncrona):** extrair `tools/lib/extract.ts` (F1.2 importa) · `tools/knowledge/worker.ts` (captura→`summarizeFeynman`→persist→`omni send`, com erro→aviso) · `tools/knowledge/server.ts` expõe `archive_link(url)` que valida + dispara `setsid bun run worker.ts` desacoplado + retorna `{ok,status:"processing"}`. Validar: rodar o worker standalone com URL real → linha no DB + mensagem chega no WhatsApp.
- **P3 — Registro + AGENTS.md + E2E:** registrar server `knowledge` (`.mcp.json` + allow), **atualizar `AGENTS.md`** (receber link → ack curto + `archive_link`, NÃO esperar o resumo no turno), matar órfãos `claude.*linkmind-agent`, mandar link no WhatsApp → ack imediato + `[C] mcp__knowledge__archive_link` no `genie agent log` + ~1-2 min depois o card chega + linha em `knowledge_node`.
- **P4 — README da tool:** `tools/knowledge/README.md` (o que faz, pipeline, shape do card, erros, como testar/registrar).

## Validação

1. **Gemini standalone:** texto real → `gemini -p` → JSON válido no shape do card (`ideia_central`, `pilares[]`, `aplicacao`) + `topico`.
2. **Pipeline standalone:** `archive_link(<url real>)` → `ok:true`, linha gravada (conferir por `SELECT`), card coerente com o artigo.
3. **Robustez:** URL inválida → `capture_failed:invalid_url`; Gemini devolvendo lixo → `gemini_bad_json` após retry; DB derrubado → `db_failed`.
4. **E2E:** link no WhatsApp → tool chamada (log) → salvo no DB → resposta curta com o card (não o texto inteiro).

## Open questions

- **Reuso do fetch** — lib compartilhada `tools/lib/extract.ts` (proposto) vs re-fetch independente vs tool chamar tool. → **Decisão: lib compartilhada** (refator de baixo risco da F1.2).
- **`topico` p/ recuperação** — gerado pelo Gemini (no mesmo JSON) vs derivado do título vs tags múltiplas. → **Proposto: Gemini gera um `topico` curto** no card; revisitar quando specar a recuperação (pode pedir tags/embeddings).
- **Connection string do autopg** — onde mora a credencial de app (não a admin)? Resolver no P0; criar um role/DB dedicado do LinkMind se fizer sentido (vs usar o default).
- **`Bun.sql` vs lib `postgres`** — preferir `Bun.sql` (zero dep); cair pra `postgres` só se atritar.
- ~~**Latência do Gemini**~~ → **RESOLVIDO/medido (P1):** 2k≈22s, 8k>120s. Motivou o **desenho assíncrono** (worker em background + ack imediato).
- ~~**Truncamento do texto pro Gemini**~~ → **RESOLVIDO (P1): `MAX_CHARS` ~4000** (equilíbrio qualidade × latência; gist costuma estar no começo).
- **Alvo do callback (worker → WhatsApp)** — MVP: instância + número fixos em env (single-user). Multi-usuário (descobrir o chat dinâmico a partir da mensagem original) = depois. Confirmar o melhor: `omni send --to <número>` vs `omni say --instance/--chat`.
- **Worker desacoplado** — `setsid bun run worker.ts` (some no fim do turno?) vs daemon que faz poll de uma fila no Postgres (status PENDING, alinha com F1.7). MVP: `setsid` fire-and-forget; migrar p/ fila se a robustez pedir.
- **Dedup por URL** — re-arquivar o mesmo link cria linha nova? v1 provavelmente **sim** (sem dedup); anotar como ideia.
```
