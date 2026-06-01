# Tool harness — LinkMind

Cada tool do agente é um **MCP server stdio** escrito em **TypeScript sob Bun**.
O agente (engine `claude` nativo, spawnado pelo bridge do Genie) descobre e chama
essas tools via o protocolo MCP.

> **Exemplo vivo:** [`hello-mcp/`](./hello-mcp/) — uma tool `ping` trivial
> (`echo?` → `pong 🏓 (<echo>)`). Use-a como molde ao criar a próxima.

---

## Convenções

- Uma tool (ou um grupo coeso de tools) = **um diretório** `tools/<nome>/`.
- Cada `tools/<nome>/` é um **projeto Bun isolado** (`package.json` + `node_modules`
  próprios) — evita conflito de dependências entre tools.
- O server usa **`@modelcontextprotocol/sdk`** (`McpServer` + `StdioServerTransport`)
  e **`zod`** para os schemas de input.
- Entrypoint do server: `tools/<nome>/server.ts`.

---

## Como adicionar uma tool

### 1. Scaffold do projeto Bun

```bash
cd ~/linkmind/tools
mkdir minha-tool && cd minha-tool
bun init -y
bun add @modelcontextprotocol/sdk zod
```

### 2. Escrever o `server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "minha-tool", version: "0.0.1" });

server.registerTool(
  "fazer_algo",
  {
    title: "Fazer Algo",
    description: "Descreva o que a tool faz — o agente lê isto para decidir quando chamá-la.",
    inputSchema: { alvo: z.string() },
  },
  async ({ alvo }) => ({
    content: [{ type: "text", text: `resultado para ${alvo}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

O **nome do server** (`minha-tool`) + o **nome da tool** (`fazer_algo`) formam o
identificador que o agente enxerga: **`mcp__minha-tool__fazer_algo`**.

Teste standalone antes de plugar no agente:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun run server.ts
```

### 3. Registrar o server no agente

Adicione a entry em **`agents/linkmind-agent/.mcp.json`** (o `claude` nativo lê esse
arquivo do cwd no startup):

```jsonc
{
  "mcpServers": {
    "hello": { "command": "bun", "args": ["run", "/home/lucsb/linkmind/tools/hello-mcp/server.ts"] },
    "minha-tool": { "command": "bun", "args": ["run", "/home/lucsb/linkmind/tools/minha-tool/server.ts"] }
  }
}
```

> Use **caminho absoluto** no `args` — o cwd do spawn é o dir do agente, não o da tool.

### 4. Auto-aprovar a tool

Sem isso, o agente pede aprovação manual a cada chamada (que ninguém vê no WhatsApp).
Em **`agents/linkmind-agent/.claude/settings.local.json`**:

```jsonc
{
  "enableAllProjectMcpServers": true,
  "permissions": {
    "allow": ["mcp__hello__ping", "mcp__minha-tool__fazer_algo"]
  }
}
```

> ⚠️ **`.claude/settings.local.json` é git-ignored** (regra `.claude/` no `.gitignore`).
> Ele não vem no clone — quem montar o ambiente do zero precisa recriá-lo com o
> conteúdo acima. Mantenha este README como a fonte de verdade desses valores.

### 5. Verificar E2E

O **próximo turno** (novo spawn do `claude`) já carrega o `.mcp.json` — não precisa
reiniciar o serve. Mande uma mensagem no WhatsApp que peça a tool e confira o log:

```bash
genie agent log linkmind-agent | tail -20
```

Procure por `[C] mcp__minha-tool__fazer_algo`. Sucesso = a tool foi chamada.

---

## Armadilhas (aprendidas no spike F0.2)

- **NÃO registre tools via `sdk.mcpServers`/`sdk.allowedTools` no `agent.yaml`.**
  O bridge do WhatsApp spawna o `claude` nativo **sem** `--mcp-config`/`--allowedTools`,
  então esse bloco é **ignorado** (só vale no modo SDK/print, ex. smoke-test). O caminho
  que funciona é o `.mcp.json` + `settings.local.json` acima. Ver `.specs/features/F0.2-agente-real-tools/discovery.md`.
- **Verifique pelo `genie agent log`, NÃO pelo `genie agent observe`** — os contadores do
  `observe` ficam em `0`/`no linked session` (a view não está plugada no `claude` do bridge).
- **Turnos mortos no meio deixam processos `claude` órfãos vivos.** Se um spawn novo
  engasgar no `--resume`, mate o órfão (`pkill -f "claude.*linkmind-agent"`) — a sessão
  fica em disco e o próximo turno re-spawna relendo o `.mcp.json`/`AGENTS.md`.
- **Caminho absoluto no `.mcp.json`** — caminho relativo quebra porque o cwd é o do agente.
