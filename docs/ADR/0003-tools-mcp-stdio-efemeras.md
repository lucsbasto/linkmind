# ADR 0003 — Tools = MCP servers stdio efêmeros via `.mcp.json`

**Status:** Aceito (2026-06-01)
**Contexto da feature:** F0.2 (tool harness), reconfirmado em F1.2/F1.4

## Contexto

Decorrência do [ADR 0002](0002-engine-claude-cli-nativo.md): como o bridge spawna o
`claude` CLI nativo (não o SDK), as tools precisam entrar pelo mecanismo que o CLI nativo
entende. O `claude` nativo lê **`.mcp.json` do cwd do agente** e aprova tools via
`.claude/settings.local.json` (`enableAllProjectMcpServers: true` + `permissions.allow`).
`settingSources` vazio faz o SDK ignorar o filesystem — mas isso é no caminho SDK, não no
do CLI nativo.

## Decisão

Cada tool é um **MCP server stdio** em TypeScript sob **Bun**, projeto isolado em
`tools/<nome>/` com seu próprio `node_modules`. Registro:

- `agents/linkmind-agent/.mcp.json` — declara os servers (`knowledge`, `web`, `hello`).
- `agents/linkmind-agent/.claude/settings.local.json` — auto-aprova as tools.

Os servers são **spawnados sob demanda pelo turno** (stdio), não são serviços
long-running. Trabalho lento (captura + Gemini) roda **desacoplado** num worker
`setsid bun run worker.ts` que faz callback por `omni send`.

## Consequências

- ✅ Adicionar uma tool = novo dir + entrada no `.mcp.json` + `permissions.allow` + nota no `AGENTS.md`.
- ✅ Isolamento de deps por tool; nada de monólito.
- ⚠️ Toda tool nova exige atualizar o `AGENTS.md` (gatilho/ack), senão o agente não a usa.
- ⚠️ Como são efêmeras, não há um "processo de tool" no `pm2 ls` — o `make verify` testa o miolo (DB) por um script determinístico, não por um serviço vivo.

## Alternativas consideradas

- **Tools como serviços HTTP long-running:** desnecessário; o protocolo MCP stdio já cobre o ciclo de vida do turno.
