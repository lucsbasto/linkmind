# ADR 0005 — Persistência = pgserve por socket unix `trust`

**Status:** Aceito (2026-06-01)
**Contexto da feature:** F1.4/P0 (DB + migrations)

## Contexto

A stack já traz o **pgserve/autopg** (Postgres como pacote global supervisionado por PM2),
exposto por **socket unix** em `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432` com `pg_hba`
`local all all trust`. Ao conectar com `Bun.sql` por `hostname`+`port`, dava
`Connection closed` (negociação TLS). Descobrimos que a forma que funciona é
`new SQL({ path: <socket>, tls: false })`.

## Decisão

Persistir em **Postgres via pgserve, conectando pelo socket unix com `trust`** (sem
senha), usando `Bun.sql` com `{ path, username, database, tls:false }`. Tudo overridável
por env (`LINKMIND_PG_SOCKET`/`_DB`/`_USER`) — defaults no `db.ts`. Schema mínimo
`knowledge_node`, migrations idempotentes (`IF NOT EXISTS`) aplicadas por `migrate.ts`.

Quirk registrado: **`Bun.sql` devolve colunas `jsonb` como string** → `JSON.parse(row.card)`
ao ler (o `make verify` testa esse round-trip).

## Consequências

- ✅ Zero config de credencial p/ um MVP local (trust no socket).
- ✅ Conexão rápida e estável; reaproveita a infra que já sobe com a stack.
- ⚠️ `trust` no socket só é aceitável porque é **local, single-user**; um deploy multi-tenant/VPS exigiria auth real (ver Known Tensions do STATE).
- ⚠️ Acopla ao pgserve — trocar por Postgres em container quebraria o socket-trust (ver [ADR 0001](0001-sem-docker-compose.md)).

## Alternativas consideradas

- **Postgres em container + host/porta + senha:** quebra o socket-trust que o resto usa; mais setup. Descartado p/ o v1.
- **SQLite:** simples, mas perde o jsonb/SQL concorrente que F1.7 (`SKIP LOCKED`) vai precisar.
