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
import { findSummaries, markRecalled } from "./recall.ts";
import { releasePending } from "./release.ts";
import { sendWhatsApp, formatCard } from "./notify.ts";
import { validateHttpUrl } from "./url.ts";

const WORKER = join(import.meta.dir, "worker.ts");
const QA_WORKER = join(import.meta.dir, "qa-worker.ts");
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
  const check = validateHttpUrl(rawUrl);
  if (!check.ok) return { ok: false, error: check.error };
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

// Q&A ASSÍNCRONO sobre o texto puro de um artigo salvo. Usa Gemini (lento) →
// mesmo desenho do archive_link: dispara um worker detached e retorna na hora.
// A resposta chega DEPOIS, numa mensagem nova. `assunto` é opcional — vazio = o
// artigo mais recente ("qual o pseudocódigo do artigo").
function askArticle(pergunta: string, assunto: string, chat: string): ArchiveResult {
  if (!pergunta || !pergunta.trim()) return { ok: false, error: "missing_pergunta" };
  if (!chat || !chat.trim()) return { ok: false, error: "missing_chat: destino da resposta não informado" };

  const logFd = openSync(WORKER_LOG, "a");
  Bun.spawn(["setsid", "bun", "run", QA_WORKER, pergunta.trim(), (assunto ?? "").trim(), chat.trim()], {
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    env: { ...process.env, PATH: WORKER_PATH },
  }).unref();

  return { ok: true, status: "processing" };
}

// Recuperação SÍNCRONA (sem Gemini/fetch → rápido): busca o card salvo por
// assunto e o reenvia pro chat. A tool faz o `omni send` (não o agente), pra o
// card voltar formatado igualzinho — sem o agente reescrever/encurtar.
type RecallResult = { ok: boolean; found?: number; topico?: string; error?: string };

async function sendSummary(assunto: string, chat: string): Promise<RecallResult> {
  if (!assunto || !assunto.trim()) return { ok: false, error: "missing_assunto" };
  const to = chat?.trim();
  if (!to) return { ok: false, error: "missing_chat" };

  let matches;
  try {
    matches = await findSummaries(assunto);
  } catch (e) {
    return { ok: false, error: `db: ${(e as Error).message}` };
  }

  if (matches.length === 0) {
    await sendWhatsApp(to, `🔍 Não achei nada salvo sobre "${assunto}".`);
    return { ok: true, found: 0 };
  }

  // Manda o mais recente como card completo e marca como LIDO (para o ciclo de
  // lembretes daquele node — ele saiu da fila de "não leu ainda").
  const top = matches[0];
  await sendWhatsApp(to, formatCard(top.card, top.title ?? undefined, top.url));
  await markRecalled(top.id).catch(() => {}); // best-effort: não falha o envio se o UPDATE der erro

  // Se houver mais de um match, lista os outros pra o usuário escolher.
  if (matches.length > 1) {
    const others = matches.slice(1).map((m) => `• ${m.title ?? m.topico}`).join("\n");
    await sendWhatsApp(to, `Tenho outros ${matches.length - 1} sobre isso:\n${others}`);
  }

  return { ok: true, found: matches.length, topico: top.topico };
}

// Release SÍNCRONO de conteúdo retido (F1.7). O usuário mandou o gatilho ("pode
// mandar", "manda") → libera o pendente mais antigo do chat (claim atômico SKIP
// LOCKED dentro de releasePending) e a própria função faz o `omni send`. Rápido
// (sem Gemini/fetch). `found:0` = não tinha nada pendente.
type ReleaseToolResult = { ok: boolean; found?: number; remaining?: number; error?: string };

async function releaseTool(chat: string): Promise<ReleaseToolResult> {
  const to = chat?.trim();
  if (!to) return { ok: false, error: "missing_chat" };
  try {
    const r = await releasePending(to);
    if (!r.released) {
      await sendWhatsApp(to, "🤔 não tem nada pendente pra te mandar.");
      return { ok: true, found: 0, remaining: 0 };
    }
    return { ok: true, found: 1, remaining: r.remaining };
  } catch (e) {
    return { ok: false, error: `db: ${(e as Error).message}` };
  }
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

server.registerTool(
  "ask_article",
  {
    title: "Ask Article",
    description:
      "Responde uma PERGUNTA ESPECÍFICA sobre um artigo JÁ SALVO, consultando o " +
      "texto COMPLETO dele com a LLM (ex.: \"qual o pseudocódigo do artigo\", \"que " +
      "exemplo ele dá\", \"o que ele fala sobre X\"). Diferente de send_summary, que " +
      "só reenvia o resumo pronto. É ASSÍNCRONO — retorna status:\"processing\" e a " +
      "resposta chega DEPOIS, numa mensagem nova (pode levar ~1 min). NÃO espere: dê " +
      "um ack curto (ex.: \"deixa eu olhar no artigo, já te falo 👀\") e feche o turno.",
    inputSchema: {
      pergunta: z.string().describe("A pergunta do usuário sobre o artigo, em linguagem natural (ex.: 'qual o pseudocódigo?')."),
      assunto: z
        .string()
        .optional()
        .describe(
          "Tema/título do artigo a consultar, se o usuário citou um (ex.: 'useEffect', " +
            "'skills'). Busca por aproximação. DEIXE VAZIO se ele disser só 'o artigo' " +
            "sem especificar — aí uso o último artigo salvo.",
        ),
      chat: z
        .string()
        .describe(
          "Chat de DESTINO da resposta — copie EXATAMENTE o valor de `chat:` do " +
            "contexto do turno (ex.: 72254369050669@lid). É pra onde a resposta vai.",
        ),
    },
  },
  async ({ pergunta, assunto, chat }) => {
    const result = askArticle(pergunta, assunto ?? "", chat);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "send_summary",
  {
    title: "Send Summary",
    description:
      "Recupera e REENVIA o resumo (card) de um link JÁ SALVO, buscando por " +
      "assunto/tópico. Use quando o usuário pedir algo como \"me manda/lembra o " +
      "resumo de X\" ou \"o que eu salvei sobre X\". A tool manda o card direto no " +
      "chat — você só dá um ack curto (ex.: \"te mandei 👍\"). Se vier found:0, " +
      "avise em uma linha que não tem nada salvo sobre isso.",
    inputSchema: {
      assunto: z
        .string()
        .describe("Assunto/tópico a buscar (ex.: 'useEffect', 'skills'). Busca por aproximação no tópico e no título."),
      chat: z
        .string()
        .describe(
          "Chat de DESTINO — copie EXATAMENTE o valor de `chat:` do contexto do " +
            "turno (ex.: 72254369050669@lid). É pra onde o card será enviado.",
        ),
    },
  },
  async ({ assunto, chat }) => {
    const result = await sendSummary(assunto, chat);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "release_pending",
  {
    title: "Release Pending",
    description:
      "Libera o conteúdo denso que ficou RETIDO (ex.: resultado de pesquisa) quando " +
      "o usuário manda o GATILHO sem assunto: \"pode mandar\", \"manda\", \"manda aí\", " +
      "\"manda o texto\", \"quero ver\". A tool entrega o pendente mais antigo direto no " +
      "chat — você só dá um ack curto. CUIDADO de desempate: \"me manda o resumo de X\" " +
      "(COM assunto) é send_summary, NÃO isto. Se vier found:0, diga em uma linha que " +
      "não tem nada pendente. Se remaining>0, avise que ainda há mais (é só pedir de novo).",
    inputSchema: {
      chat: z
        .string()
        .describe(
          "Chat de DESTINO — copie EXATAMENTE o valor de `chat:` do contexto do " +
            "turno (ex.: 72254369050669@lid). É pra onde o conteúdo retido será enviado.",
        ),
    },
  },
  async ({ chat }) => {
    const result = await releaseTool(chat);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
