/**
 * F1.5 (leitura) — Recuperação de resumos salvos por assunto/tópico.
 *
 * Busca aproximada (ILIKE) em `topico` e `title`, mais recentes primeiro. O `card`
 * volta como string do `jsonb` (quirk do Bun.sql) → JSON.parse + valida com zod.
 */
import { withDb } from "./db.ts";
import { CardSchema, type FeynmanCard } from "./summarize.ts";

export type Summary = {
  id: string;
  topico: string;
  title: string | null;
  url: string;
  card: FeynmanCard;
  created_at: string;
};

/** Resumos cujo tópico OU título casa (aproximação) com `assunto`. */
export async function findSummaries(subject: string, limit = 5): Promise<Summary[]> {
  const term = subject.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return withDb(async (db) => {
    const rows = await db`
      SELECT id, topico, title, url, card, created_at
      FROM knowledge_node
      WHERE status = 'RELEASED'                       -- F1.7: pendente não vaza na recuperação
        AND (topico ILIKE ${like} OR title ILIKE ${like})
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    return rows.map((r: any) => ({
      id: String(r.id),
      topico: r.topico,
      title: r.title,
      url: r.url,
      // jsonb volta como string no Bun.sql; tolera também já-objeto.
      card: CardSchema.parse(typeof r.card === "string" ? JSON.parse(r.card) : r.card),
      created_at: String(r.created_at),
    }));
  });
}

export type ArticleContent = {
  id: string;
  title: string | null;
  url: string;
  topico: string;
  content: string;
};

/**
 * Resultado da busca do artigo para Q&A. Distingue três casos pra dar mensagens
 * úteis: achou com texto puro (`ok`), achou mas o node é antigo/sem `content`
 * salvo (`no_content` — pré-feature de conteúdo), ou nada casou (`not_found`).
 */
export type ArticleLookup =
  | { status: "ok"; article: ArticleContent }
  | { status: "no_content"; title: string | null; url: string }
  | { status: "not_found" };

/**
 * Acha o artigo (com texto puro salvo) pra responder uma pergunta sobre ele.
 * Com `assunto`: melhor match por ILIKE em topico/title, mais recente primeiro.
 * Sem `assunto` ("qual o pseudocódigo do artigo"): cai no mais recente que tenha
 * `content`. Só serve nodes com `content` não-nulo; um match sem content (artigo
 * salvo antes da feature de conteúdo) volta como `no_content`.
 */
export async function findArticleForQA(subject: string): Promise<ArticleLookup> {
  const term = subject.trim();
  return withDb(async (db) => {
    if (!term) {
      // Sem assunto: o mais recente que tenha texto puro salvo.
      const rows = await db`
        SELECT id, title, url, topico, content
        FROM knowledge_node
        WHERE content IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`;
      if (rows.length === 0) return { status: "not_found" };
      const r: any = rows[0];
      return { status: "ok", article: { id: String(r.id), title: r.title, url: r.url, topico: r.topico, content: String(r.content) } };
    }
    // Com assunto: melhor match (mesmo sem content), pra distinguir no_content de not_found.
    const like = `%${term}%`;
    const rows = await db`
      SELECT id, title, url, topico, content
      FROM knowledge_node
      WHERE topico ILIKE ${like} OR title ILIKE ${like}
      ORDER BY (content IS NOT NULL) DESC, created_at DESC
      LIMIT 1`;
    if (rows.length === 0) return { status: "not_found" };
    const r: any = rows[0];
    if (r.content == null) return { status: "no_content", title: r.title, url: r.url };
    return { status: "ok", article: { id: String(r.id), title: r.title, url: r.url, topico: r.topico, content: String(r.content) } };
  });
}

/**
 * Marca um node como LIDO (recuperado). Zera o ciclo de lembretes: a partir daqui
 * ele não entra mais na varredura do reminder.ts (que filtra last_recalled_at IS NULL).
 */
export async function markRecalled(id: string): Promise<void> {
  await withDb((db) => db`UPDATE knowledge_node SET last_recalled_at = now() WHERE id = ${id}`);
}

// --- harness standalone: `bun run recall.ts <assunto>` ---
if (import.meta.main) {
  const subject = process.argv.slice(2).join(" ");
  if (!subject) {
    console.error("uso: bun run recall.ts <assunto>");
    process.exit(2);
  }
  const found = await findSummaries(subject);
  console.error(`[recall] ${found.length} resultado(s) para "${subject}"`);
  console.log(JSON.stringify(found, null, 2));
}
