/**
 * F1.5 (leitura) — Recuperação de resumos salvos por assunto/tópico.
 *
 * Busca aproximada (ILIKE) em `topico` e `title`, mais recentes primeiro. O `card`
 * volta como string do `jsonb` (quirk do Bun.sql) → JSON.parse + valida com zod.
 */
import { openDb } from "./db.ts";
import { CardSchema, type FeynmanCard } from "./summarize.ts";

export type Summary = {
  topico: string;
  title: string | null;
  url: string;
  card: FeynmanCard;
  created_at: string;
};

/** Resumos cujo tópico OU título casa (aproximação) com `assunto`. */
export async function findSummaries(assunto: string, limit = 5): Promise<Summary[]> {
  const term = assunto.trim();
  if (!term) return [];
  const like = `%${term}%`;
  const db = openDb();
  try {
    const rows = await db`
      SELECT topico, title, url, card, created_at
      FROM knowledge_node
      WHERE topico ILIKE ${like} OR title ILIKE ${like}
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    return rows.map((r: any) => ({
      topico: r.topico,
      title: r.title,
      url: r.url,
      // jsonb volta como string no Bun.sql; tolera também já-objeto.
      card: CardSchema.parse(typeof r.card === "string" ? JSON.parse(r.card) : r.card),
      created_at: String(r.created_at),
    }));
  } finally {
    await db.end();
  }
}

// --- harness standalone: `bun run recall.ts <assunto>` ---
if (import.meta.main) {
  const assunto = process.argv.slice(2).join(" ");
  if (!assunto) {
    console.error("uso: bun run recall.ts <assunto>");
    process.exit(2);
  }
  const found = await findSummaries(assunto);
  console.error(`[recall] ${found.length} resultado(s) para "${assunto}"`);
  console.log(JSON.stringify(found, null, 2));
}
