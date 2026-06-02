// Tool MCP `archive_link` — arquivamento ASSÍNCRONO de links (F1.4).
// Valida a URL e dispara um worker DESACOPLADO (setsid) que captura, resume
// (Gemini), salva no Postgres e manda o card de volta pelo WhatsApp. Retorna na
// hora (status:"processing") pro agente dar um ack curto sem travar o turno.
// Registro no agente = .mcp.json + .claude/settings.local.json (ver ../README.md).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const WORKER = join(import.meta.dir, "worker.ts");
const WORKER_LOG = join(import.meta.dir, "worker.log");

// O bridge (genie daemon) spawna este server com um PATH enxuto que NÃO inclui
// ~/.bun/bin — então `omni` (e às vezes `bun`) não resolvem no worker detached.
// Aumentamos o PATH aqui pra que o worker e o que ele chamar (omni) encontrem os
// binários. Caminho absoluto do omni também é garantido no worker.ts.
const BUN_BIN = `${process.env.HOME ?? "/home/lucsb"}/.bun/bin`;
const WORKER_PATH = `${BUN_BIN}:${process.env.PATH ?? ""}`;

type ArchiveResult = { ok: boolean; status?: "processing"; error?: string };

// `chat` = JID do chat de DESTINO do card (de onde o link veio). Multi-usuário:
// cada número que escreve é um chat diferente; o card tem que voltar pra ele, não
// pra um destino fixo. O agente passa esse valor a partir do contexto do turno.
function archiveLink(rawUrl: string, chat: string): ArchiveResult {
  // Valida antes de disparar (não gasta worker em URL inválida).
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: "invalid_url: protocolo não suportado" };
    }
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (!chat || !chat.trim()) {
    return { ok: false, error: "missing_chat: destino do card não informado" };
  }

  // Dispara o worker desacoplado: `setsid` o coloca numa sessão nova, então ele
  // sobrevive ao fim do turno (quando o claude/MCP server morre). Não-await.
  // O `chat` vai como argv[3] → o destino fica preso ao link no momento da chamada
  // (imune a outro usuário escrever depois e trocar o contexto ativo do omni).
  // stdout/stderr vão pro worker.log (não /dev/null) pra falha ser diagnosticável;
  // PATH aumentado pro omni resolver no contexto detached do bridge.
  const logFd = openSync(WORKER_LOG, "a");
  Bun.spawn(["setsid", "bun", "run", WORKER, rawUrl, chat.trim()], {
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    env: { ...process.env, PATH: WORKER_PATH },
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
    inputSchema: {
      url: z.string().describe("URL http(s) do link a arquivar"),
      chat: z
        .string()
        .describe(
          "Chat de DESTINO do card — copie EXATAMENTE o valor de `chat:` do " +
            "contexto do turno (ex.: 72254369050669@lid). É pra onde o resumo será " +
            "enviado quando ficar pronto. SEMPRE preencha com o chat do remetente.",
        ),
    },
  },
  async ({ url, chat }) => {
    const result = archiveLink(url, chat);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
