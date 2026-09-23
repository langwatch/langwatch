---
name: clickhouse-migration
description: "Change the ClickHouse schema without breaking the running release: where the goose migrations live and how they are numbered, one statement per StatementBegin block, why a variable-size column added by ALTER needs a DEFAULT, why down migrations stay commented out, partition keys and TTL, deduped tables and argMax, the retirement note required before any DROP or type change, keeping the serverless renderer's catalogue in step when a migration adds or changes a view, and the expand/contract recipes. Use whenever someone says 'add a ClickHouse column', 'change that column type', 'drop the old table', 'write a goose migration', 'Code 173', 'Code 241', or the migration-safety test named their migration."
user-invocable: true
argument-hint: "<the schema change, or the migration name the scanner refused>"
---

# Change the ClickHouse schema without breaking the running release

The whole rule: **a migration is applied to the live database before the new image
rolls, so the old image keeps serving against the new schema — and if the roll is
reverted, the new schema outlives the image that wanted it.** Both directions have to
work. Deployment order can never matter. ADR-155 is the ruling; this is how.

Files: `packages/clickhouse-migrations/migrations/<NNNNN>_<slug>.sql`, applied by goose
in sequence order. Read `dev/docs/best_practices/clickhouse-queries.md` before writing
any query the migration implies.

```bash
pnpm clickhouse:migrate   # apply; also what the pipeline runs as a task, before serve
```

Number the new file one above the highest on `origin/main`, not one above your branch —
goose only runs migrations above the version a database is already on, so a file that
merges with a lower number never runs there at all. The `migration-order` workflow fails
the PR and prints the rename.

## The file's shape

```sql
-- +goose Up
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS GitBranches Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS GitBranches;
```

Every line of that is load-bearing:

- **`${CLICKHOUSE_DATABASE}` with `ENVSUB ON`** — the database name is deployment
  configuration, and a hard-coded one is wrong on every installation that chose another.
- **One statement per `StatementBegin`/`StatementEnd` pair.** ClickHouse has no
  multi-statement query, so a second statement in one block is sent as part of the first
  and the migration fails halfway, leaving the schema in neither shape.
- **`IF NOT EXISTS` / `IF EXISTS`** — migrations are re-run by more than one replica
  racing to boot; idempotence is what makes that a no-op rather than an error.
- **`DEFAULT []` on any variable-size column** (`Array`, `Map`, `Tuple`, `Nested`). A
  variable-size column added by `ALTER` is unmaterialised in every part written before
  it, and a read of such a part without a default decodes garbage — **Code 173** at read
  time, **Code 241** at merge time. This is the single most common ClickHouse outage in
  this repository's history.
- **The down migration stays commented out**, under the words `To roll back, uncomment
  and run manually.` A ClickHouse down migration is destructive and irreversible, so it
  is never something goose runs on its own; the way back from a bad release is the
  previous image on the migrated schema, which is what expand/contract guarantees.

## Recipe: add a column

One release, and that is the whole story — a new column is invisible to the image still
serving, and `SELECT` names its columns.

```sql
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries ADD COLUMN IF NOT EXISTS Tier String DEFAULT '';
```

`SELECT *` in application code is what would break this, which is one more reason
nothing in this repository writes it.

## Recipe: change a column's type

Never with `MODIFY COLUMN`. A type change rewrites every part while the image still
serving decodes the old type, and there is no moment where both are right.

1. **Add** a column with the new type and a `DEFAULT`, beside the old one.
2. **Dual-write** both, and backfill history (`ALTER TABLE … UPDATE` is a mutation: it
   is asynchronous, rewrites parts, and is watched, not awaited).
3. **Switch the readers.**
4. **Retire** the old column one full release later, with the note.

`MODIFY COLUMN` that sets only a `CODEC`, a `TTL` or a comment is not a type change and
is fine — write `MODIFY COLUMN <name> CODEC(…)` without restating the type, so that it
does not read as one either.

## Recipe: remove a column, a table or a view

Two releases. Release N stops reading and writing it; release N+1 drops it, with the
note naming the release that stopped:

```sql
-- contract: retired in 1.42.0
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS LegacyCost;
```

**Replacing a view is not a drop-and-create.** `CREATE OR REPLACE VIEW`, or
`EXCHANGE TABLES` for a materialized one — every read in the gap between a `DROP` and
its `CREATE` fails, and on a live tenant that gap is measured in queries, not seconds.

## What a new table must get right

- **`PARTITION BY` the time column** the reads filter on (`StartedAt`, `OccurredAt`,
  `StartTime`), because partition pruning is the difference between a local read and a
  scan of every cold partition in S3.
- **`TenantId` first in the sorting key**, because no other id is unique across tenants
  and every query filters it first.
- **A version column** (`UpdatedAt`) on anything deduped, and reads that dedup with an
  IN-tuple (`GROUP BY key + max(UpdatedAt)`), never `LIMIT 1 BY` over heavy columns —
  `LIMIT 1 BY` materialises whole granules of the payload and OOMs the query.
- **`argMax(column, UpdatedAt)` for sort keys** on a deduped table; `max()` picks a
  stale version and breaks cursor pagination.
- **A retention expression** (`_retention_days`, `TTL … DELETE`) matching the policy in
  `@langwatch/data-retention-contract`, which the TTL reconciler brings back into line.

## A migration that adds or changes a view touches the catalogue too

The Go serverless renderer keeps its own copy of the LangWatchQL access model:
`infra/clickhouse-serverless/internal/render/lwql_catalog.json` lists the source tables
behind per-tenant row filters and the caller-facing views the `langwatch_lwql` user may
select from. It is asserted equal to the application's catalogue by
`modules/analytics/process/src/rules/__tests__/manifestParity.unit.test.ts`, so a new
queryable table or view without the matching entry fails CI — and a *missing* entry on a
serverless installation is a query that refuses rather than a query that leaks.

## The scanner

```bash
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/clickhouse-migrations test src/__tests__/migration-safety.unit.test.ts
```

It reads every migration not in `src/__tests__/migration-safety.baseline.txt` and fails
by name, with the fix, on: a `DROP` or a `MODIFY COLUMN` type change without the
retirement note, a variable-size column with no `DEFAULT`, more than one statement in a
goose block, and a down migration that is not commented out. The baseline is the
migrations already shipped when the scanner landed; it is **frozen**. Adding your
migration's name to it to get green is refused by the baseline test.

Spec: `specs/ops/migration-safety.feature`. Postgres: the `postgres-migration` skill.
