# F0.2 — Esqueleto do agente (Claude Agent SDK) + tool harness

**Milestone:** M0 — Fundação
**Status:** ✅ CONCLUÍDA (P1+P2+P3 — 2026-06-01)
**Depende de:** F0.1 (stack + WhatsApp pareado + agente respondendo) ✅
**Discovery:** ver `discovery.md` (mecânica de registro de tools resolvida).

## Goal

Estabelecer o **esqueleto operacional do agente real**: o agente roda via Claude Agent SDK dentro do Genie, com um **tool harness em TS/Bun** funcionando (1 tool dummy registrada e chamável), e um **system prompt inicial** (sem hardening). É a fundação sobre a qual as tools reais de captura/pesquisa (M1) serão plugadas.

> **Importante (escopo):** F0.2 **não** implementa captura de link/YouTube. Isso é M1 (`F1.2 fetch_web_content`, `F1.3 get_youtube_transcript`). Aqui só provamos o *harness* com uma tool dummy.

## Scope

**In:**
1. **Convenções do tool harness** (TS/Bun): onde tools vivem, como são escritas (MCP stdio server), como são registradas no agente.
2. **1 tool dummy** registrada e funcional ponta a ponta (a `hello/ping` do smoke-test promovida a dummy canônica do harness).
3. **System prompt inicial** do agente (substituir os placeholders de `AGENTS.md`) — define missão, tom anti-textão e que o agente deve usar tools quando apropriado. Sem hardening (isso é F1.8).
4. **Permissão da tool** no caminho WhatsApp real (auto-aprovação via `--sdk-allowed-tools`).
5. **Validação E2E pelo WhatsApp**: usuário manda mensagem → agente responde "ack" e chama a dummy → valor visível no WhatsApp.

**Out (fica para M1+):**
- Detecção de intenção (F1.1), scraper (F1.2), transcript YouTube (F1.3), Feynman (F1.4), persistência Postgres (F1.5), Brave Search (F1.6), gatilho anti-textão (F1.7), hardening do prompt (F1.8), Docker Compose (F1.9).

## Definition of Done (do ROADMAP)

> Agente responde "ack" e chama tool dummy retornando valor visível no WhatsApp.

Concretamente:
- [x] `agents/linkmind-agent/AGENTS.md` com system prompt inicial real (não placeholder). _(P2 ✅ 2026-06-01)_
- [x] Tool dummy montada **e** auto-aprovada — via **`agents/linkmind-agent/.mcp.json`** + `.claude/settings.local.json` (`enableAllProjectMcpServers` + `permissions.allow: ["mcp__hello__ping"]`). **NÃO** via `sdk.mcpServers`/`sdk.allowedTools` — o bridge ignora o bloco `sdk` (ver correção no `discovery.md`). _(P1 ✅ 2026-06-01)_
- [x] Mensagem no WhatsApp ("use a tool ping com echo=oi") → resposta `pong 🏓 (oi)`, **sem** aprovação manual. _(P1 ✅ 2026-06-01)_
- [x] Tool event registrado — via **`genie agent log linkmind-agent`** (`[C] mcp__hello__ping`). ⚠️ `genie agent observe` mostra `0`/`no linked session` (view não plugada no claude do bridge); a verificação de tool event é pelo `log`, não pelo `observe`. _(P1 ✅ 2026-06-01)_

## Design

### Convenções do tool harness

- Cada tool (ou grupo coeso de tools) = um **MCP server stdio** em TypeScript, rodando sob **Bun**, sob `tools/<nome>/server.ts`.
- SDK: **`@modelcontextprotocol/sdk`** (`McpServer` + `StdioServerTransport`), schemas de input via `zod`.
- Cada `tools/<nome>/` é um projeto Bun isolado (`package.json` + `node_modules` próprios) — evita conflito de deps entre tools.
- **Registro no agente (MECANISMO CORRETO — ver correção no `discovery.md`):** o bridge spawna o `claude` nativo no cwd `agents/linkmind-agent/` e **NÃO** injeta `--mcp-config`/`--allowedTools`. O bloco `sdk.mcpServers`/`sdk.allowedTools` do `agent.yaml` é **ignorado pelo bridge** (só vale no modo SDK/print). Registrar via filesystem:
  - **`agents/linkmind-agent/.mcp.json`**: `{ "mcpServers": { "<name>": { "command": "bun", "args": ["run", "/abs/tools/<name>/server.ts"] } } }`. (o `claude` nativo lê `.mcp.json` do cwd por default.)
  - **Auto-aprovação em `agents/linkmind-agent/.claude/settings.local.json`**: `"enableAllProjectMcpServers": true` (aprova o server de projeto) + `"permissions": { "allow": ["mcp__<server>__<tool>", ...] }` (auto-aprova a chamada; nome exposto = `mcp__<server>__<tool>`).
- Após editar `.mcp.json`/settings: o **próximo turno** (novo spawn) já carrega — o `.mcp.json` é lido no startup do `claude`. Não precisa matar a sessão (mas se um turno foi morto no meio, o resume pode engasgar — aí reciclar `genie serve stop/start`).
- Verificação de tool event: **`genie agent log linkmind-agent`** (`[C] mcp__hello__ping`), NÃO `genie agent observe` (contadores ficam em 0 — view não plugada no claude do bridge).

### Tool dummy

- Reusar `tools/hello-mcp/server.ts` (tool `ping`, input `echo?`, output `pong 🏓 (<echo>)`). Já validada standalone e via engine `claude` (print mode).
- Serve como referência viva do harness para as tools reais de M1.

### System prompt inicial (AGENTS.md)

Substituir os placeholders por:
- **Missão:** segundo cérebro no WhatsApp; capturar conhecimento e responder sem poluir o chat.
- **Comportamento:** responder curto; usar tools disponíveis quando a tarefa pedir; nunca despejar textão sem ser pedido.
- **Constraint:** sempre fechar o turno via `omni done` (mecanismo do Genie).
- Marcar explicitamente que captura/pesquisa reais **ainda não existem** (evitar alucinar capacidades antes de M1).

## Stories / tarefas

- **P1 — Harness + dummy auto-aprovada no caminho real:** ✅ **CONCLUÍDO 2026-06-01.** Mecanismo final (após descobrir que o bridge ignora `sdk.*`): `.mcp.json` no dir do agente + `enableAllProjectMcpServers`/`permissions.allow` no `settings.local.json`. Validado E2E: WhatsApp "use a tool ping com echo=oi" → `pong 🏓 (oi)` sem aprovação manual; tool call visível em `genie agent log`.
- **P2 — System prompt inicial:** ✅ **CONCLUÍDO 2026-06-01.** `AGENTS.md` reescrito (missão = segundo cérebro no WhatsApp; tom anti-textão; usar tools quando a tarefa pedir; sempre fechar com `omni done`; marcado que captura/pesquisa reais NÃO existem ainda — anti-alucinação). Bridge confirmado carregando-o via `--append-system-prompt-file`. Bloco `sdk.*` inerte removido do `agent.yaml` (limpeza pendente do P1). Validado E2E: WhatsApp "me dá um aço e roda o pink com echo=p2" (autocorrect de "ack/ping") → agente leu "aço"=áudio, chamou `mcp__hello__ping`, mandou voice note + texto `pong 🏓 (p2)` e fechou com `omni done`. Comportamento (curto, usou tool, fechou turno) governado pelo novo prompt.
- **P3 — Documentar o harness:** ✅ **CONCLUÍDO 2026-06-01.** `tools/README.md` escrito com o passo-a-passo "como adicionar uma tool" (scaffold Bun → `server.ts` MCP → `.mcp.json` → auto-aprovação em `settings.local.json` → verificar via `genie agent log`), incluindo as armadilhas do spike (bridge ignora `sdk.*`; `observe` não conta; órfãos `claude`; caminho absoluto). Comentário stale do `hello-mcp/server.ts` corrigido. **F0.2 fechada — segue M1.**

## Validação

1. **Permissão real:** mensagem WhatsApp dispara a dummy **sem** prompt de aprovação (prova que `--sdk-allowed-tools` cobre o `permissionMode default` do bridge).
2. **E2E ack+tool:** uma única mensagem natural ("me dá um ack e roda o ping") → resposta contém "ack" + `pong 🏓`.
3. **Observability:** `genie agent observe linkmind-agent` mostra o tool event e custo > $0.

## Open questions

- O `permissionMode default` do bridge realmente exige `allowedTools` para tools MCP, ou auto-aprova MCP servers locais? (Resolver no P1 — se já auto-aprovar, `--sdk-allowed-tools` vira opcional.)
- Precisaremos de `omni done` explícito no prompt, ou o bridge fecha o turno sozinho? (Observado funcionar na F0.1; confirmar com a tool no meio.)
