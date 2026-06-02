/**
 * F1.4 / P1 — Sumarização Feynman via Gemini CLI.
 *
 * Recebe o texto capturado (F1.2) e devolve um "card" estruturado:
 *   { ideia_central, pilares[], aplicacao, topico }
 *
 * Motor = Gemini CLI nativo (`gemini -p`, OAuth headless). O texto vai por
 * **stdin** (evita ARG_MAX); a instrução vai no `-p`. Capturamos só o stdout —
 * o ruído ("Ripgrep is not available", "[ERROR] [IDEClient] ...") sai no stderr.
 * Valida o JSON com zod e faz 1 retry com instrução reforçada se vier inválido.
 */
import { z } from "zod";

export const CardSchema = z.object({
  ideia_central: z.string().min(1),
  pilares: z.array(z.string().min(1)).min(1),
  aplicacao: z.string().min(1),
  topico: z.string().min(1),
});
export type FeynmanCard = z.infer<typeof CardSchema>;

export type SummarizeResult =
  | { ok: true; card: FeynmanCard }
  | { ok: false; error: string };

const MAX_CHARS = 16_000; // texto enviado ao Gemini. Como roda em background (worker), priorizamos fidelidade sobre latência.
const GEMINI_TIMEOUT_MS = 360_000; // 6 min — a latência cresce muito com o tamanho (2k≈22s, 8k>120s); em background dá pra esperar

function buildPrompt(reinforce: boolean): string {
  const base = [
    "Você é um sintetizador no estilo Feynman. O conteúdo de um artigo está no stdin.",
    "Resuma-o e responda APENAS com um objeto JSON válido (sem markdown, sem cercas ```), com exatamente estas chaves:",
    '- "ideia_central": uma frase com a ideia central do texto.',
    '- "pilares": array de 2 a 5 strings, cada uma um aprendizado/pilar essencial (core takeaway).',
    '- "aplicacao": uma frase sobre como aplicar isso na prática.',
    '- "topico": um tópico curto (2-4 palavras) que identifique o assunto, para busca futura.',
    "Escreva em português. Seja conciso e fiel ao texto; não invente fatos.",
  ];
  if (reinforce) {
    base.push(
      "IMPORTANTE: sua resposta anterior não era um JSON válido no formato pedido.",
      "Responda SOMENTE o JSON, começando com { e terminando com }, sem texto antes ou depois.",
    );
  }
  return base.join("\n");
}

/** Extrai o primeiro objeto JSON de uma saída que pode vir com cercas/ruído. */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Remove cercas ```json ... ``` se houver.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? trimmed;
  // Pega do primeiro { ao último } (tolera prefácio/epílogo).
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("nenhum objeto JSON encontrado na saída");
  }
  return JSON.parse(body.slice(start, end + 1));
}

async function runGemini(promptText: string, stdinText: string): Promise<string> {
  const proc = Bun.spawn(["gemini", "-p", promptText], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore", // descarta o ruído (ripgrep/IDEClient)
    timeout: GEMINI_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  // Escreve o texto e FECHA o stdin (EOF) — senão o gemini fica esperando input.
  proc.stdin.write(stdinText);
  await proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`gemini saiu com código ${code}`);
  if (!out.trim()) throw new Error("gemini retornou saída vazia");
  return out;
}

export async function summarizeFeynman(text: string): Promise<SummarizeResult> {
  const content = text.slice(0, MAX_CHARS);
  if (!content.trim()) return { ok: false, error: "texto vazio para resumir" };

  let lastErr = "";
  for (const reinforce of [false, true]) {
    try {
      const raw = await runGemini(buildPrompt(reinforce), content);
      const parsed = CardSchema.safeParse(extractJson(raw));
      if (parsed.success) return { ok: true, card: parsed.data };
      lastErr = `validação falhou: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { ok: false, error: `gemini_bad_json: ${lastErr}` };
}

// --- Q&A sobre o texto puro do artigo (F: pergunta sobre artigo salvo) ---

const QA_MAX_CHARS = 24_000; // texto do artigo enviado ao Gemini pra Q&A (roda em background → prioriza cobertura)

export type AnswerResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

/**
 * Responde uma pergunta usando SOMENTE o texto puro do artigo (`content`). Resposta
 * livre (não JSON) — só capturamos o stdout do Gemini. A pergunta vai no `-p` (argv,
 * sem shell → sem injeção); o artigo vai no stdin (evita ARG_MAX). Sem retry: se o
 * Gemini falhar, devolvemos o erro pra avisar o usuário em vez de insistir.
 */
export async function answerQuestion(pergunta: string, articleText: string): Promise<AnswerResult> {
  const text = articleText.slice(0, QA_MAX_CHARS);
  if (!text.trim()) return { ok: false, error: "artigo sem texto" };
  if (!pergunta.trim()) return { ok: false, error: "pergunta vazia" };

  const prompt = [
    "O conteúdo completo de um artigo está no stdin.",
    `Responda à seguinte pergunta do usuário usando SOMENTE as informações desse artigo: "${pergunta.trim()}"`,
    "Seja direto e fiel ao texto. Se a pergunta pede um trecho específico (código, pseudocódigo, citação, lista), reproduza-o tal como aparece no artigo.",
    "Se a resposta NÃO estiver no artigo, diga em uma frase que o artigo não fala sobre isso — não invente nem complete com conhecimento externo.",
    "Responda em português, conciso, em texto corrido para WhatsApp (evite markdown pesado).",
  ].join("\n");

  try {
    const raw = await runGemini(prompt, text);
    const answer = raw.trim();
    if (!answer) return { ok: false, error: "gemini retornou vazio" };
    return { ok: true, answer };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- harness standalone: `bun run summarize.ts <arquivo-de-texto>` ---
if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error("uso: bun run summarize.ts <arquivo-de-texto>");
    process.exit(2);
  }
  const text = await Bun.file(file).text();
  console.error(`[summarize] enviando ${Math.min(text.length, MAX_CHARS)} chars ao gemini...`);
  const t0 = Bun.nanoseconds();
  const res = await summarizeFeynman(text);
  const ms = Math.round((Bun.nanoseconds() - t0) / 1e6);
  console.error(`[summarize] levou ${ms}ms`);
  console.log(JSON.stringify(res, null, 2));
}
