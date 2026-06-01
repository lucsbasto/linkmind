// Tool MCP `archive_link` — arquivamento ASSÍNCRONO de links (F1.4).
// Valida a URL e dispara um worker DESACOPLADO (setsid) que captura, resume
// (Gemini), salva no Postgres e manda o card de volta pelo WhatsApp. Retorna na
// hora (status:"processing") pro agente dar um ack curto sem travar o turno.
// Registro no agente = .mcp.json + .claude/settings.local.json (ver ../README.md).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { z } from "zod";

const WORKER = join(import.meta.dir, "worker.ts");

type ArchiveResult = { ok: boolean; status?: "processing"; error?: string };

function archiveLink(rawUrl: string): ArchiveResult {
  // Valida antes de disparar (não gasta worker em URL inválida).
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: "invalid_url: protocolo não suportado" };
    }
  } catch {
    return { ok: false, error: "invalid_url" };
  }

  // Dispara o worker desacoplado: `setsid` o coloca numa sessão nova, então ele
  // sobrevive ao fim do turno (quando o claude/MCP server morre). Não-await.
  Bun.spawn(["setsid", "bun", "run", WORKER, rawUrl], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();

  return { ok: true, status: "processing" };
}

const server = new McpServer({ name: "knowledge", version: "0.1.0" });

server.registerTool(
  "archive_link",
  {
    title: "Archive Link",
    description:
      "Arquiva um link: captura o conteúdo, resume no estilo Feynman e salva. " +
      "É ASSÍNCRONO — retorna na hora com status:\"processing\" e o resumo chega " +
      "DEPOIS, numa mensagem nova (pode levar 1-2 min). Ao chamar, NÃO espere o " +
      "resultado: mande um ack curto avisando que recebeu e que vai resumir/salvar.",
    inputSchema: { url: z.string().describe("URL http(s) do link a arquivar") },
  },
  async ({ url }) => {
    const result = archiveLink(url);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
