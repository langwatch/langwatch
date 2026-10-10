---
name: haven-db
description: "Reset, reseed, locate and prune a haven stack's databases with `haven db`, and know which verbs destroy data. Use when someone says 'haven db', 'reset the database', 'drop the database', 'reseed in place', 'db preset', 'demo preset', 'database url', 'connection string for postgres', 'haven db prune', 'haven seed', 'haven db status', 'haven db logins', 'stray test databases', 'clickhouse url', or 'the api refuses because the database is below the LTS floor'."
user-invocable: true
argument-hint: "<reset|seed|url|prune|status|logins> [preset|engine] [--yes]"
---

# haven db

`haven db` is the one noun for this stack's data (its own Postgres database, ClickHouse
database and Redis db). `haven obs query` is not SQL: it reads the stack's telemetry (see `haven-logs`).

| Verb                                         | Effect                                                                                           | Destroys data |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------- |
| `haven db reset [preset]`                    | drops and recreates this stack's databases, migrates, then seeds                                 | yes           |
| `haven db seed [preset]`                     | idempotent upsert of the preset's content; drops nothing                                         | no            |
| `haven db url [postgres\|clickhouse\|redis]` | prints the real loopback connection string(s), engine optional                                   | no            |
| `haven db status`                            | connection URLs, the last seed run and its preset, the migration state (was `haven seed status`) | no            |
| `haven db logins [--reveal]`                 | prints the seeded logins, credentials masked unless `--reveal`                                   | no            |
| `haven db prune [--dry-run\|--yes]`          | lists (dry run, the default) or drops stray test and apidiff databases older than `HAVEN_DB_TTL` | with `--yes`  |

Presets: `bare`, `demo`, `onboarding`, `post-onboarding` (`haven db` with no verb lists them;
`haven help db` does not). `demo` maps to `haven db seed --size tiny --persona startup`
(`haven-seed`).

## Destructive: ask first

`haven db reset` and `haven down --destroy --stack <slug>` drop data, and `haven db prune --yes` drops
databases. **An agent asks the user before running any of them**, naming the database. As an
agent, haven refuses without `--yes`; adding `--yes` is the user's decision, not yours.

- `reset` on the shared main database (the one every worktree without its own falls back to)
  is louder: a person must type the database's name; `--yes` still works and says what it drops.
- `haven down --destroy --stack <slug> --yes` stops a stack by slug and drops its databases (`haven-lifecycle`).
- `db seed` refuses `--yes` (nothing to confirm). `db url` refuses it too.
- `haven db reset` on the stack home: an api refused because the database is below the LTS floor
  shows a reset button; it migrates and seeds exactly the databases it dropped.
- The seed guard refuses when a database URL points anywhere but local dev.

## Connection strings

`haven db url postgres` prints the real connection string, credentials included. Treat it as a
secret: use it in a shell, never paste it into an issue. Plain `haven env` masks it (`haven-env`).
Postgres has no hostname; ClickHouse does (`clickhouse.<slug>.langwatch.localhost`, HTTP).
