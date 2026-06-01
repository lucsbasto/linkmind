# F1.4 — Resumo Feynman (Gemini CLI) + persistência (escrita)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 📝 SPEC — escrita 2026-06-01; implementação não iniciada.
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

## Definition of Done

- [ ] Tabela `knowledge_node` criada no autopg via migration versionada (re-rodável).
- [ ] `gemini -p` produz um card Feynman **JSON válido** a partir de um texto real, parseado e validado (zod) pela tool.
- [ ] `tools/knowledge/server.ts` expõe `archive_link(url)` que: captura (lib compartilhada), resume (Gemini), persiste, e retorna `{ ok, id, title, topico, card }` — **sem despejar o texto inteiro**.
- [ ] Erros estruturados por etapa (captura falhou / Gemini falhou ou JSON inválido / DB falhou) com `ok:false` + categoria.
- [ ] Tool registrada (`.mcp.json` server `knowledge` + `mcp__knowledge__archive_link` em `settings.local.json`) **e `AGENTS.md` atualizado** descrevendo a capacidade de arquivar.
- [ ] **E2E WhatsApp:** mandar um link → `[C] mcp__knowledge__archive_link` no `genie agent log` → linha gravada em `knowledge_node` (conferível por query) → resposta curta com o card (anti-textão).
- [ ] README curto da tool em `tools/knowledge/`.

## Design

### Interface da tool

```ts
archive_link(url: string) -> {
  ok: boolean
  id?: string            // PK da linha em knowledge_node
  url?: string           // URL final (após redirects)
  title?: string
  topico?: string        // tópico curto p/ recuperação futura ("me envia o link de tal assunto")
  card?: {               // o resumo Feynman estruturado
    ideia_central: string
    pilares: string[]    // core takeaways
    aplicacao: string    // aplicação prática
  }
  error?: string         // preenchido quando ok=false: categoria + detalhe
}
```

O agente, ao responder no WhatsApp, manda um **resumo curto do card** + confirmação de
que salvou — não o `text` capturado nem o JSON cru.

### Pipeline server-side (dentro de `archive_link`)

1. **Captura** — `extractArticle(url)` da lib compartilhada (= miolo da F1.2: fetch + UA + timeout + linkedom/Readability + limites). Reaproveita robustez/erros já validados.
2. **Resumo (Gemini)** — montar prompt pedindo **estritamente JSON** no shape do `card` + um `topico` curto; rodar `gemini -p "<prompt + texto truncado>"` headless; capturar stdout; extrair o JSON (tolerar cercas ```); **validar com zod**; 1 retry com instrução reforçada se inválido.
3. **Persistência** — `INSERT` em `knowledge_node` (url, title, topico, card jsonb, summary_text, created_at), retornando `id`.

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

- **P0 — Conexão + migration:** descobrir/validar a connection string do autopg (DB, user, senha — `~/.autopg/`), criar (ou usar) database do LinkMind, aplicar a migration `knowledge_node`. Validar `INSERT`/`SELECT` standalone via `Bun.sql`.
- **P1 — Sumarização Gemini:** função `summarizeFeynman(text)` — prompt + `gemini -p` headless + extração/validação zod do JSON + 1 retry + silenciar ruído. Validar standalone com um artigo real (texto capturado pela F1.2) → card coerente.
- **P2 — Refator lib + tool `archive_link`:** extrair `tools/lib/extract.ts` (F1.2 importa), montar `tools/knowledge/server.ts` orquestrando captura → resumo → persist, com erros por etapa. Validar standalone com uma URL real → linha no DB + retorno do card.
- **P3 — Registro + AGENTS.md + E2E:** registrar server `knowledge` (`.mcp.json` + allow), **atualizar `AGENTS.md`**, matar órfãos `claude.*linkmind-agent`, mandar link no WhatsApp → conferir `[C] mcp__knowledge__archive_link` no `genie agent log` + linha em `knowledge_node` + resposta curta com o card.
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
- **Latência do Gemini** — `gemini -p` levou dezenas de segundos no probe (cold start). Definir timeout e mensagem clara; medir no P1 (pode exigir feedback "tô resumindo..." no WhatsApp se passar de X s).
- **Dedup por URL** — re-arquivar o mesmo link cria linha nova? v1 provavelmente **sim** (sem dedup); anotar como ideia.
- **Truncamento do texto pro Gemini** — qual `MAX_CHARS` mandar no prompt (custo/limite de contexto)? Definir no P1.
```
