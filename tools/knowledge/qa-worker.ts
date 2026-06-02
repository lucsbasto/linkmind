/**
 * Worker de Q&A sobre artigo salvo (roda DESACOPLADO do turno do agente).
 *
 * Disparado por `ask_article` via `setsid bun run qa-worker.ts <pergunta> <assunto> <chat>`.
 * Faz o trabalho lento (busca o texto puro salvo → pergunta ao Gemini → envia a
 * resposta pelo WhatsApp). Mesmo desenho do worker.ts de arquivamento: detached pra
 * sobreviver ao fim do turno, e o destino (`<chat>`) vem preso à chamada.
 *
 * Q&A usa o `content` (texto INTEIRO do artigo, salvo na migration 003) — não o card.
 * Perguntar sobre um artigo conta como ENGAJAR com ele → marca como lido (sai da fila
 * de lembretes de "não leu ainda").
 */
import { findArticleForQA, markRecalled } from "./recall.ts";
import { answerQuestion } from "./summarize.ts";
import { sendWhatsApp } from "./notify.ts";

const OMNI_TO = process.argv[4] ?? process.env.LINKMIND_OMNI_TO ?? "";

async function main(): Promise<void> {
  const pergunta = process.argv[2];
  const assunto = process.argv[3] ?? "";
  if (!pergunta) {
    console.error("[qa] uso: bun run qa-worker.ts <pergunta> <assunto> <chat>");
    process.exit(2);
  }
  if (!OMNI_TO) {
    console.error("[qa] ABORT: chat de destino vazio (argv[4]/LINKMIND_OMNI_TO)");
    process.exit(2);
  }

  // 1. Acha o artigo (com texto puro) a consultar.
  const found = await findArticleForQA(assunto);
  if (found.status === "not_found") {
    await sendWhatsApp(
      OMNI_TO,
      assunto.trim()
        ? `🔍 Não achei nenhum artigo salvo sobre "${assunto.trim()}" pra eu consultar.`
        : `🔍 Ainda não tenho nenhum artigo com o texto completo salvo pra consultar.`,
    );
    return;
  }
  if (found.status === "no_content") {
    await sendWhatsApp(
      OMNI_TO,
      `📄 Achei *${found.title ?? "esse artigo"}*, mas ele foi salvo antes de eu passar a guardar o texto completo. Me reenvia o link que eu releio e aí consigo responder.`,
    );
    return;
  }
  const article = found.article;

  // 2. Pergunta ao Gemini usando só o texto puro do artigo.
  const res = await answerQuestion(pergunta, article.content);
  if (!res.ok) {
    await sendWhatsApp(OMNI_TO, `⚠️ Não consegui consultar o artigo agora (${res.error}).\n🔗 ${article.url}`);
    return;
  }

  // 3. Devolve a resposta (com o título de referência). Engajou → marca lido.
  const header = `🔎 *${article.title ?? article.topico}*`;
  await sendWhatsApp(OMNI_TO, `${header}\n\n${res.answer}`);
  await markRecalled(article.id).catch(() => {}); // best-effort: não falha a resposta se o UPDATE der erro
}

const startedAt = new Date().toISOString();
console.error(`[qa] start ${startedAt} pergunta=${process.argv[2]} assunto=${process.argv[3] ?? ""}`);
main()
  .then(() => console.error(`[qa] done`))
  .catch((e) => {
    console.error(`[qa] CRASH: ${(e as Error).stack ?? e}`);
    process.exit(1);
  });
