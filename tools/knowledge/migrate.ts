/**
 * Runner de migrations do LinkMind (idempotente).
 *
 * Cria o database alvo se faltar e aplica, em ordem, todos os `migrations/*.sql`.
 * Cada migration deve ser re-rodável (usar IF NOT EXISTS). Sem tabela de controle
 * por enquanto — o volume é pequeno e os scripts são idempotentes.
 *
 * Uso: `bun run migrate.ts`
 */
import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { openDb, pgSocketPath } from "./db.ts";

const DB_NAME = process.env.LINKMIND_PG_DB ?? "linkmind";
const SOCKET = pgSocketPath();
const USER = process.env.LINKMIND_PG_USER ?? "postgres";

async function ensureDatabase(): Promise<void> {
  const admin = new SQL({ path: SOCKET, username: USER, database: "postgres", tls: false });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${DB_NAME}`;
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE ${DB_NAME}`); // nome controlado por env, não input externo
      console.log(`[migrate] database criado: ${DB_NAME}`);
    } else {
      console.log(`[migrate] database já existe: ${DB_NAME}`);
    }
  } finally {
    await admin.end();
  }
}

async function applyMigrations(): Promise<void> {
  const dir = join(import.meta.dir, "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("[migrate] nenhuma migration encontrada");
    return;
  }
  const db = openDb(DB_NAME);
  try {
    for (const file of files) {
      const sql = await Bun.file(join(dir, file)).text();
      await db.unsafe(sql);
      console.log(`[migrate] aplicada: ${file}`);
    }
  } finally {
    await db.end();
  }
}

await ensureDatabase();
await applyMigrations();
console.log("[migrate] ok");
