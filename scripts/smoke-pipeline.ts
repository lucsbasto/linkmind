/**
 * scripts/smoke-pipeline.ts — check determinístico do miolo de persistência.
 *
 * Chamado por `make verify` (scripts/verify.sh). Exercita a MESMA camada de DB que
 * o worker usa (socket trust → INSERT → SELECT → jsonb round-trip), provando que
 * socket, database, migrations e schema estão sãos — SEM tocar Gemini nem WhatsApp
 * (que são lentos, gastam quota e têm efeito colateral). O E2E real (link via
 * WhatsApp → card) continua sendo o aceite manual documentado no README.
 *
 * Idempotente e sem efeito permanente: a linha de teste tem url sentinela
 * `https://__smoke__.linkmind.local/<ts>` e é removida no fim (inclusive sobras de
 * execuções anteriores que tenham crashado antes do cleanup).
 *
 * Exit 0 = ok; ≠0 = alguma asserção falhou (verify.sh marca ✗ naquele check).
 */
import { openDb } from "../tools/knowledge/db.ts";

const SENTINEL_HOST = "__smoke__.linkmind.local";

function die(msg: string): never {
  console.error(`[smoke] FALHOU: ${msg}`);
  process.exit(1);
}

const db = openDb();
const url = `https://${SENTINEL_HOST}/${Date.now()}`;
const card = {
  ideia_central: "smoke",
  pilares: ["a", "b"],
  aplicacao: "verify",
  topico: "smoke-test",
};

try {
  // Limpa sobras de runs anteriores (cleanup defensivo).
  await db`DELETE FROM knowledge_node WHERE url LIKE ${"https://" + SENTINEL_HOST + "/%"}`;

  // INSERT — mesmo shape do worker.ts.
  await db`
    INSERT INTO knowledge_node (url, title, topico, card, summary_text, chat, content)
    VALUES (${url}, ${"Smoke Test"}, ${card.topico},
            ${JSON.stringify(card)}::jsonb, ${"resumo de smoke"},
            ${"smoke@local"}, ${"conteúdo completo de smoke"})`;

  // SELECT de volta — valida persistência + colunas das migrations (content/chat).
  const rows = await db`
    SELECT url, card, content, chat, created_at
    FROM knowledge_node WHERE url = ${url}`;
  if (rows.length !== 1) die(`esperava 1 linha, veio ${rows.length}`);

  const row = rows[0];
  if (!row.content) die("coluna content vazia (migration 003 aplicada?)");
  if (!row.chat) die("coluna chat vazia (migration 002 aplicada?)");
  if (!row.created_at) die("created_at ausente");

  // jsonb volta como string no Bun.sql — o round-trip precisa reconstruir o objeto.
  const parsed = typeof row.card === "string" ? JSON.parse(row.card) : row.card;
  if (parsed.topico !== card.topico) die("jsonb round-trip do card divergiu");

  // Cleanup.
  await db`DELETE FROM knowledge_node WHERE url = ${url}`;
  const left = await db`SELECT 1 FROM knowledge_node WHERE url = ${url}`;
  if (left.length !== 0) die("cleanup não removeu a linha de teste");

  console.log("[smoke] ok — socket + schema + migrations + jsonb round-trip");
  process.exit(0);
} catch (e) {
  die((e as Error).message);
} finally {
  await db.end();
}
