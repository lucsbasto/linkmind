# F0.2 — Discovery / Spike: mecânica de registro de tools TS/Bun no Genie

**Data:** 2026-06-01
**Objetivo do spike:** resolver a decisão adiada na F0.1 — *como registrar uma tool customizada (TS/Bun) no agente do stack Omni/Genie?* (originalmente atribuída ao provider `nats-genie`).

> ## ⚠️ CORREÇÃO 2026-06-01 (caminho WhatsApp real) — LEIA PRIMEIRO
>
> O mecanismo descrito abaixo (`genie dir edit --sdk-mcp-server` → `sdk.mcpServers` no `agent.yaml`) **NÃO funciona no caminho turn-based do bridge WhatsApp**. Validado empiricamente (P1): o bridge spawna o **`claude` CLI nativo** com `--permission-mode auto --resume <session> --settings <inline> --append-system-prompt-file ...` e **NÃO injeta `--mcp-config` nem `--allowedTools`**. Logo `sdk.mcpServers`/`sdk.allowedTools` do `agent.yaml` são **ignorados pelo bridge** (só valem no modo SDK/print `claude -p --mcp-config <json>`, que foi exatamente o que o smoke test usou — daí o falso positivo).
>
> **Mecanismo que FUNCIONA no bridge (confirmado E2E via WhatsApp):**
> 1. cwd do spawn = `agents/linkmind-agent/`. O `claude` nativo lê **`.mcp.json` do cwd** por padrão. → criar `agents/linkmind-agent/.mcp.json` com `{ "mcpServers": { "hello": { "command": "bun", "args": ["run", "/abs/.../server.ts"] } } }`.
> 2. auto-aprovar em `agents/linkmind-agent/.claude/settings.local.json`: `"enableAllProjectMcpServers": true` (aprova o server de projeto) **+** `"permissions": { "allow": ["mcp__hello__ping"] }` (auto-aprova a chamada da tool). O `--setting-sources` não é passado pelo bridge → as sources default (user/project/local) carregam o `settings.local.json`.
> 3. Resultado E2E: WhatsApp "use a tool ping com echo=oi" → agente chamou `mcp__hello__ping` → `pong 🏓 (oi)` **sem aprovação manual**.
>
> **Observabilidade:** `genie agent observe` mostra `tool events: 0` / `no linked session` (a view não está plugada no claude do bridge). O tool call aparece no **`genie agent log linkmind-agent`** (`[C] mcp__hello__ping`). Usar `log`, não os contadores do `observe`, para verificar tool events do bridge.
>
> **Pegadinha do `genie dir edit`:** ele **substitui** o bloco `sdk:` inteiro (não faz merge) — passar todos os flags `--sdk-*` juntos. (Agora irrelevante para tools, já que o bridge ignora o bloco — mas vale para outros campos sdk.)
>
> O texto original abaixo fica como registro do spike (a mecânica SDK existe, só não é a que o bridge usa).

## Conclusão (TL;DR)

A premissa original estava **errada**: tools **não** se registram no provider `nats-genie`. Esse provider é **puro transporte** (WhatsApp/Omni ↔ agente, via NATS). O agente é spawnado pelo Genie através do **`@anthropic-ai/claude-agent-sdk`** (embutido no binário do Genie), e tools customizadas entram como **MCP servers** na config SDK do agente.

**Caminho oficial de registro:**

```bash
genie dir edit <agent-name> --sdk-mcp-server <name>:<command>:<args>
```

Formato do spec: `name:command:args` (validado por `parseMcpServer`; erro literal: *"Expected name:command:args"*). É repetível (um `--sdk-mcp-server` por tool/server).

Exemplo para a primeira tool de captura (Bun stdio MCP server):

```bash
genie dir edit linkmind-agent \
  --sdk-mcp-server linkmind-capture:bun:run,/home/lucsb/linkmind/tools/capture/server.ts
```

> `args` é separado por vírgula no spec CLI (`run,/abs/path/server.ts`).

## Como descobrimos (cadeia de evidências, lendo o binário `~/.genie/bin/genie`)

1. **Topologia (skill `omni`, SKILL.md):**
   ```
   nats-genie provider → NATS subject omni.message.<inst>.*
   → genie-omni-bridge → spawns claude in <agent.dir> with --resume <session>
   → Claude responde via `omni say`
   ```
   Logo, `nats-genie` só roteia mensagens; quem executa é um processo `claude` no diretório do agente.

2. **Engine = Claude Agent SDK** (strings do binário): o objeto de opções do SDK aparece literal —
   `{ ..., settingSources, allowedTools, disallowedTools, tools, mcpServers, strictMcpConfig, ... }`
   e a mensagem `Reinstall @anthropic-ai/claude-agent-sdk`. O SDK envelopa o binário nativo `claude` (por isso o agente autentica pelo login do CLI, não pela `ANTHROPIC_API_KEY` — aprendizado da F0.1).

3. **Genie injeta seu próprio MCP server** no spawn:
   `mcpServers: { "genie-omni-tools": doneMcp }` — é como o agente faz `omni say` / `omni done`.
   Tools customizadas são **mescladas** nesse mesmo mapa via `config.mcpServers[parsed.name] = parsed.config`.

4. **`settingSources ?? []` (default vazio)** → o SDK **NÃO** lê `.mcp.json` / `.claude/settings.json` do filesystem por padrão. Portanto **dropar um `.mcp.json` no dir do agente NÃO funciona** — tem que ir pela config SDK do entry.

5. **Persistência da config:** o entry do diretório (e o frontmatter do `agent.yaml`) carregam um bloco `sdk:` (`fm.sdk`, `entry2.sdk`; schema `SdkDirectoryConfigSchema`). `genie dir add`/`genie dir edit` chamam `registerSdkFlags(cmd)` que expõe os flags `--sdk-*`. Em runtime, `translateSdkConfig(sdkConfig)` converte `sdk.mcpServers` nas opções do SDK.

   Equivalente declarativo no `agent.yaml` (alternativa ao flag CLI):
   ```yaml
   model: sonnet
   promptMode: append
   sdk:
     mcpServers:
       linkmind-capture:
         command: bun
         args: [run, /home/lucsb/linkmind/tools/capture/server.ts]
   ```
   *(Schemas suportados: `SdkMcpStdioServerConfigSchema` (command/args/env), `SdkMcpSSEServerConfigSchema`, `SdkMcpHttpServerConfigSchema`.)*

## Implicações para a F0.2

- A tool de captura (link/YouTube) será um **MCP server stdio em TS rodando sob Bun** (`bun run server.ts`), usando o SDK MCP padrão (`@modelcontextprotocol/sdk` ou `tool()`/`createSdkMcpServer` do Agent SDK).
- Registro: `genie dir edit linkmind-agent --sdk-mcp-server ...` (ou bloco `sdk:` no `agent.yaml`).
- Pode ser necessário liberar a tool em `--sdk-allowed-tools` para auto-aprovação (o nome da tool MCP costuma ser `mcp__<server>__<tool>`).
- **Zero alteração** no provider `nats-genie` ou no Omni.
- Lembrar de re-spawnar/resetar a sessão do agente após editar o entry para o SDK recarregar a config.

## Validação empírica (smoke test — 2026-06-01) ✅

Confirmado de ponta a ponta com um MCP server "hello world" (`tools/hello-mcp/server.ts`, tool `ping`):

1. **Server standalone OK:** handshake MCP + `tools/list` + `tools/call` respondem (`pong 🏓 (linkmind)`).
2. **Registro persiste:** `genie dir edit linkmind-agent --sdk-mcp-server hello:bun:run,/abs/server.ts` →
   `genie dir ls` mostra `SDK Config: MCP Servers: hello`; `agent.yaml` ganhou o bloco:
   ```yaml
   sdk:
     mcpServers:
       hello:
         type: stdio
         command: bun
         args: [run, /home/lucsb/linkmind/tools/hello-mcp/server.ts]
   ```
   (o `type: stdio` é inferido pelo Genie a partir do spec `name:command:args`.)
3. **Engine carrega e CHAMA a tool:** replicando o que o bridge faz —
   `claude -p "...ping..." --mcp-config <json> --allowedTools mcp__hello__ping --dangerously-skip-permissions`
   (rodado em `agents/linkmind-agent/`) → retornou exatamente `pong 🏓 (smoketest)`. Engine = `claude` 2.1.159.

**Aprendizados do smoke test:**
- Nome da tool exposto ao agente = **`mcp__<server>__<tool>`** (aqui `mcp__hello__ping`).
- SDK MCP escolhido = **`@modelcontextprotocol/sdk` (stdio standalone)** v1.29.0 — alinhado ao mecanismo `name:command:args`. Decisão fechada.
- **Permissão:** no smoke usei `--dangerously-skip-permissions`. No caminho real (WhatsApp → bridge, turn-based), o bridge spawna com `permissionMode default` → a tool MCP provavelmente **pede aprovação** (sem ninguém pra aprovar). Para o caminho WhatsApp funcionar, liberar a tool no entry via `genie dir edit linkmind-agent --sdk-allowed-tools mcp__hello__ping` (ou o nome da tool real). **A confirmar empiricamente no caminho WhatsApp.**

## Pendências antes de codar a tool real

- [x] ~~Confirmar a forma do bloco `sdk.mcpServers`~~ — validado (ver acima).
- [x] ~~Decidir SDK MCP~~ — `@modelcontextprotocol/sdk` stdio standalone.
- [ ] Confirmar auto-aprovação via `--sdk-allowed-tools` no **caminho WhatsApp real** (não só print mode).
- [ ] Definir contrato da 1ª tool: `capture_link` (input: URL; output: metadados + conteúdo extraído).
- [ ] Limpar o smoke (`tools/hello-mcp/` + remover `hello` do entry) quando deixar de ser útil.
