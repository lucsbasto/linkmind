/**
 * F1.10 — harness do banco descartável para a trilha de integração.
 *
 * Cria (se ausente) o DB `linkmind_test`, roda as migrations `migrations/00x_*.sql`
 * e expõe helpers de seed/limpeza/teardown. NUNCA toca o `linkmind` real.
 *
 * Como funciona o isolamento (descoberto na F1.4/db.ts):
 *  - `openDb()` lê `LINKMIND_PG_DB` em tempo de chamada e conecta por socket unix
 *    (trust, sem senha). Setar `process.env.LINKMIND_PG_DB = "linkmind_test"` ANTES
 *    de chamar recall/reminder faz essas funções mirarem o DB de teste.
 *  - `Bun.sql` devolve `jsonb` como string → seeds gravam `JSON.stringify(card)`.
 *
 * Uso típico (no test file):
 *   beforeAll(async () => { await setupTestDb(); });
 *   afterEach(async () => { await truncateAll(); });
 *   afterAll(async () => { await teardownTestDb(); });
 */
import { SQL } from "bun";
import { pgSocketPath } from "../db.ts";

export const TEST_DB = "linkmind_test";
const MAINTENANCE_DB = "postgres";
const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;
const MIGRATIONS = ["001_knowledge_node.sql", "002_reminders.sql", "003_content.sql"];

let handle: SQL | null = null;

function user(): string {
  return process.env.LINKMIND_PG_USER ?? "postgres";
}

/** Conexão de manutenção (DB `postgres`) — usada só para CREATE DATABASE. */
function maintenanceDb(): SQL {
  return new SQL({ path: pgSocketPath(), username: user(), database: MAINTENANCE_DB, tls: false });
}

/**
 * Garante o pgserve no ar e devolve o socket. Se não estiver acessível, falha com
 * mensagem clara — a trilha de integração precisa do DB vivo (ver tests/README.md).
 */
async function assertPgUp(): Promise<void> {
  const sock = pgSocketPath();
  try {
    const m = maintenanceDb();
    await m`SELECT 1`;
    await m.end();
  } catch (e) {
    throw new Error(
      `[db-helper] pgserve não acessível em ${sock} — a trilha de integração precisa do DB vivo.\n` +
        `Suba o pgserve (\`pgserve restart\` ou \`pgserve postmaster --data ~/.autopg/data\`) e rode de novo.\n` +
        `Causa: ${(e as Error).message}`,
    );
  }
}

/** Cria o DB de teste se ausente (idempotente). */
async function createTestDbIfAbsent(): Promise<void> {
  const m = maintenanceDb();
  try {
    const rows = await m`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
    if (rows.length === 0) {
      // CREATE DATABASE não aceita parâmetro bind → nome é literal controlado (constante).
      await m.unsafe(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await m.end();
  }
}

/** Roda as 3 migrations contra o DB de teste (todas idempotentes / IF NOT EXISTS). */
async function runMigrations(db: SQL): Promise<void> {
  for (const file of MIGRATIONS) {
    const sql = await Bun.file(MIGRATIONS_DIR + file).text();
    await db.unsafe(sql);
  }
}

/**
 * Prepara o DB de teste e aponta o ambiente para ele. Após esta chamada, qualquer
 * `openDb()` (recall/reminder) mira `linkmind_test`. Idempotente.
 */
export async function setupTestDb(): Promise<SQL> {
  await assertPgUp();
  await createTestDbIfAbsent();
  // A partir daqui, recall/reminder (que leem LINKMIND_PG_DB no openDb) miram o teste.
  process.env.LINKMIND_PG_DB = TEST_DB;
  handle = new SQL({ path: pgSocketPath(), username: user(), database: TEST_DB, tls: false });
  await runMigrations(handle);
  await truncateAll();
  return handle;
}

/** Handle SQL do DB de teste para seeding direto (lança se setup não rodou). */
export function db(): SQL {
  if (!handle) throw new Error("[db-helper] setupTestDb() não foi chamado");
  return handle;
}

export type NodeSeed = {
  url?: string;
  title?: string | null;
  topico?: string | null;
  card?: unknown;
  summary_text?: string | null;
  content?: string | null;
  chat?: string | null;
  /** idade em dias (0 = agora); vira created_at = now() - idade. */
  created_days_ago?: number;
  last_recalled_at?: Date | null;
  reminder_count?: number;
  last_reminder_at?: Date | null;
};

const DEFAULT_CARD = {
  ideia_central: "ideia central de teste",
  pilares: ["pilar a", "pilar b"],
  aplicacao: "aplicação de teste",
  topico: "topico teste",
};

/**
 * Insere um knowledge_node de teste e devolve seu id. Campos não informados usam
 * defaults sensatos. `card` é gravado como `jsonb` via stringify (quirk Bun.sql).
 * `created_days_ago` torna a idade determinística para os testes de reminder.
 */
export async function insertNode(partial: NodeSeed = {}): Promise<string> {
  const h = db();
  const card = partial.card ?? DEFAULT_CARD;
  const days = partial.created_days_ago ?? 0;
  const rows = await h`
    INSERT INTO knowledge_node
      (url, title, topico, card, summary_text, content, chat,
       created_at, last_recalled_at, reminder_count, last_reminder_at)
    VALUES (
      ${partial.url ?? "https://example.com/seed"},
      ${partial.title ?? "Artigo de Teste"},
      ${partial.topico ?? "topico teste"},
      ${JSON.stringify(card)}::jsonb,
      ${partial.summary_text ?? null},
      ${partial.content ?? null},
      ${partial.chat ?? null},
      now() - make_interval(days => ${days}),
      ${partial.last_recalled_at ?? null},
      ${partial.reminder_count ?? 0},
      ${partial.last_reminder_at ?? null}
    )
    RETURNING id`;
  return String((rows[0] as any).id);
}

/** Limpa todas as linhas entre testes (afterEach). */
export async function truncateAll(): Promise<void> {
  await db()`TRUNCATE TABLE knowledge_node`;
}

/** Fecha o handle de teste (afterAll). */
export async function teardownTestDb(): Promise<void> {
  if (handle) {
    await handle.end();
    handle = null;
  }
}
