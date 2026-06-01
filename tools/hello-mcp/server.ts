// Smoke-test MCP server (stdio) para validar o registro de tools customizadas
// no agente LinkMind via `genie dir edit --sdk-mcp-server`.
// Expõe uma única tool trivial: `ping` → "pong 🏓 (<echo>)".
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "hello",
  version: "0.0.1",
});

server.registerTool(
  "ping",
  {
    title: "Ping",
    description:
      "Teste de fumaça. Retorna 'pong' com um echo opcional. Use para confirmar que a tool MCP customizada está acessível ao agente.",
    inputSchema: { echo: z.string().optional() },
  },
  async ({ echo }) => ({
    content: [
      {
        type: "text",
        text: `pong 🏓${echo ? ` (${echo})` : ""}`,
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
