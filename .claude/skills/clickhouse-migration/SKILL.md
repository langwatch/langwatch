---
name: clickhouse-migration
description: "Change the ClickHouse schema without breaking any release still in the supported window: where the goose migrations live and how they are numbered, one statement per StatementBegin block, IF NOT EXISTS / IF EXISTS on every statement, why a variable-size column added by ALTER needs a DEFAULT, why down migrations stay commented out, partition keys and TTL, deduped tables and argMax, the LTS-floor rule and retirement note required before any DROP or type change, historic values by a background step instead of an operator comment, a changed view under a new name, keeping the LWQL catalogue in step, and the expand/contract recipes. Use whenever someone says 'add a ClickHouse column', 'change that column type', 'drop the old table', 'replace the view', 'backfill a ClickHouse column', 'MATERIALIZE', 'write a goose migration', 'Code 173', 'Code 241', or the migration-safety test named their migration."
user-invocable: true
argument-hint: "<the schema change, or the migration name the scanner refused>"
---

# Change the ClickHouse schema inside the window

**The rule** (plan 6.12; Alex, N1): every release from the LTS floor to head must keep running on
every later schema. `upgrade` steps an installation release by release (goose `up-to` each release's
last version, plan 6.4) while the old pods keep serving, so every intermediate schema has to suit
them too. Every change is expand/contract, and a destructive step may only remove what **no release
at or above the LTS floor** reads. An LTS is named every six months (Alex, N4). The plan is
`dev/docs/plans/migrations-rethink-2026-10-06.md` (revision 4), cited as "plan 6.x"; ADR-155 is the
original ruling, widened from "one full release" to the floor. Which recipe applies at all: the
`migration` skill.

Files: `packages/clickhouse-migrations/migrations/<NNNNN>_<slug>.sql`, applied by goose in sequence
order. Read `dev/docs/best_practices/clickhouse-queries.md` before writing any query the migration
implies. ClickHouse has no foreign keys; the no-relations ruling (the `postgres-migration` skill)
asks nothing here.

```bash
pnpm clickhouse:migrate   # apply (today; the `upgrade` command replaces it at S3, plan 8)
```

**Numbering.** One above the highest on `origin/main`, not one above your branch: goose runs only
above the version a database is on, so a lower number never runs there. The `migration-order`
workflow fails the PR and prints the rename. Under stepping a goose version in a later release that
sorts below an earlier release's last version is refused outright, which is why this branch's
`00101` to `00104` must be resolved against main before the first release (plan 4, F10; S4).

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

Every line is load-bearing:

- **`${CLICKHOUSE_DATABASE}` with `ENVSUB ON`**: the database name is deployment configuration.
- **One statement per `StatementBegin`/`StatementEnd` pair.** ClickHouse has no multi-statement
  query; a second statement fails the migration halfway, leaving neither shape.
- **`IF NOT EXISTS` / `IF EXISTS` on every statement.** goose on ClickHouse has no transactions, so
  a half-run migration is re-run from its first statement (plan 2, H4; plan 6.11). The scanner rule
  for it lands with S7.
- **`DEFAULT` on any variable-size column** (`Array`, `Map`, `Tuple`, `Nested`). Parts written
  before an `ALTER` are unmaterialised and decode as garbage without one: **Code 173** at read,
  **Code 241** at merge. The most common ClickHouse outage in this repository's history.
- **The down migration stays commented out**, under `To roll back, uncomment and run manually.`
  The way back is the previous image on the migrated schema, which the window guarantees.

## Recipe: add a column

One release: a new column with a `DEFAULT` is invisible to every older release, because `SELECT`
names its columns (nothing here writes `SELECT *`).

```sql
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries ADD COLUMN IF NOT EXISTS Tier String DEFAULT '';
```

**Historic values are a background data step**, a `MATERIALIZE COLUMN` or `ALTER TABLE ... UPDATE`
run on the worker, never a comment asking the operator to run it (plan 6.12, the "ClickHouse add
column" row; today's comments in `00034`, `00035`, `00062`, `00063`, `00076` are what that replaces,
plan 3.2 K2). A mutation is asynchronous and rewrites parts: the step starts it, watches
`system.mutations`, and is level-triggered (the `migration-data-step` skill). Until `.withMigrations`
lands (S6), write it as a module task.

## Recipe: change a column's type

Never `MODIFY COLUMN` to a new type: it rewrites every part while older releases decode the old type.

1. **Expand**: a new column of the new type with a `DEFAULT`, beside the old.
2. **Migrate**: dual-write from release A; a background step backfills history; readers switch in A.
3. **Contract**: drop the old column once the LTS floor is at or above A, with the note.

`MODIFY COLUMN` that sets only a `CODEC`, a `TTL` or a comment is not a type change: write
`MODIFY COLUMN <name> CODEC(...)` without restating the type.

## Recipe: remove a column, a table or a view

Release A stops reading it; the first release whose LTS floor is at or above A drops it, with the note
naming A:

```sql
-- contract: retired in 1.42.0
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS LegacyCost;
```

**No floor is declared yet** (S9). Until one is, leave the drop out and raise it with the
coordinator: a lane does not pick the floor.

## Recipe: change a view

- **Same columns, same meaning** (a fix to the body): `CREATE OR REPLACE VIEW`, or
  `EXCHANGE TABLES` for a materialized one. Never drop-and-create: every read in the gap fails.
- **Different columns**: a view replaced in place is destructive (plan 6.12, enforcement item 2).
  Create a new view under a new name, switch readers in release A, drop the old view under the
  floor rule.

Either way the catalogue moves with it (below).

## What a new table must get right

- **`PARTITION BY` the time column** the reads filter on (`StartedAt`, `OccurredAt`, `StartTime`):
  partition pruning is the difference between a local read and a scan of cold partitions in S3.
- **`TenantId` first in the sorting key**: no other id is unique across tenants.
- **A version column** (`UpdatedAt`) on anything deduped, and reads that dedup with an IN-tuple
  (`GROUP BY key` + `max(UpdatedAt)`), never `LIMIT 1 BY` over heavy columns (it OOMs).
- **`argMax(column, UpdatedAt)` for sort keys** on a deduped table; `max()` picks a stale version.
- **A retention expression** (`_retention_days`, `TTL ... DELETE`) matching
  `@langwatch/data-retention-contract`; the TTL reconciler, run on every `upgrade` and not a step,
  brings it back into line (plan 3.2 K3).

## A migration that adds or changes a view touches the catalogue too

The application owns the LangWatchQL access model (ADR-159). The views and the source tables behind
per-tenant row filters are the catalogue in
`modules/analytics/process/src/rules/lwql-view-catalog.rules.ts` (`LWQL_VIEW_CATALOG`), pinned by
`modules/analytics/process/src/rules/__tests__/lwql-clickhouse-catalogue.unit.test.ts` (spec
`specs/lwql/catalogue-grants.feature`). A new queryable table or view without its entry fails CI; a
missing entry refuses a query rather than leaking one.

## The scanner

```bash
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/clickhouse-migrations test src/__tests__/migration-safety.unit.test.ts
```

It reads every migration not in `src/__tests__/migration-safety.baseline.txt` and fails by name,
with the fix: a `DROP` or a `MODIFY COLUMN` type change without the note, a variable-size column with
no `DEFAULT`, more than one statement in a goose block, a down migration not commented out. Also
landed (commit 4f47c8098e): the retirement note's release checked against the LTS floor,
`IF [NOT] EXISTS` required, and no view replaced in place. The baseline is **frozen**; adding your migration to it is refused.

Spec: `specs/ops/migration-safety.feature`. Postgres: the `postgres-migration` skill.
