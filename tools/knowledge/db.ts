/**
 * Conexão Postgres (autopg/pgserve) para o LinkMind.
 *
 * Auth via **socket unix com trust** (pg_hba: `local all all trust`) — sem senha.
 * Descoberto na F1.4/P0: a forma que funciona no Bun.sql é `{ path: <socket>, ... }`
 * (NÃO `hostname`+`port`, que dá "Connection closed" por negociação TLS).
 *
 * Quirk importante: `Bun.sql` devolve colunas `jsonb` como **string** — use
 * `JSON.parse(row.card)` ao ler.
 *
 * Portabilidade (MVP p/ terceiros): socket/DB são overridáveis por env:
 *   - LINKMIND_PG_SOCKET  (default: $XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432 → /run/user/<uid>/pgserve/...)
 *   - LINKMIND_PG_DB      (default: "linkmind")
 *   - LINKMIND_PG_USER    (default: "postgres")
 */
import { SQL } from "bun";

const DEFAULT_PORT = 5432;

function defaultSocket(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
  return `${runtimeDir}/pgserve/.s.PGSQL.${DEFAULT_PORT}`;
}

export function pgSocketPath(): string {
  return process.env.LINKMIND_PG_SOCKET ?? defaultSocket();
}

export function openDb(database = process.env.LINKMIND_PG_DB ?? "linkmind"): SQL {
  return new SQL({
    path: pgSocketPath(),
    username: process.env.LINKMIND_PG_USER ?? "postgres",
    database,
    tls: false,
  });
}

/**
 * Abre uma conexão, roda `fn` e garante o `end()` no finally. Remove o
 * boilerplate `openDb()/try/finally/end()` repetido nas queries de leitura/escrita.
 */
export async function withDb<T>(fn: (db: SQL) => Promise<T>): Promise<T> {
  const db = openDb();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
