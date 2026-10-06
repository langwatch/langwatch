---
name: migration
description: "Route any change to stored data or its shape to the right recipe under the ruled migration design: one mechanism (ledger, runner, `upgrade`), steps declared per module with .withMigrations, version-by-version stepping, expand/contract inside the LTS window, blocking steps as frozen SQL, background steps on the worker, per-owner tenant state, archive-or-fail. Says what has landed and what to write today instead. Use when someone says 'write a migration', 'backfill', 'data migration', 'tenant migration', 'system migration', 'move this to object storage', 'storage move', 'drop the old table', 'retire the legacy column', 'clean up old data', 'is this a breaking migration', 'LTS floor', 'upgrade command', 'withMigrations', 'blocking or background', 'held tenant', or does not know which migration skill applies."
user-invocable: true
argument-hint: "<the change: a schema edit, a backfill, a tenant migration, a storage move, a retirement>"
---

# Migrations: which recipe, under which rule

The design is ruled: `dev/docs/plans/migrations-rethink-2026-10-06.md` (revision 4) and Alex's
answers in `.claude/coordinator/rulings-2026-10-05.md` (section "Alex, 2026-10-06"). This skill
routes a request to its recipe. It does not restate the plan; it cites it as "plan 6.x".

## The one rule every recipe serves

**Inside the supported window, every step is expand/contract** (plan 6.12; Alex, N1). The window
is every release from the **LTS floor** to head. A step may add; a destructive step (a drop, a
rename, a type change, `NOT NULL` or a new constraint on a populated column, a view replaced with
different columns) may only remove what **no release at or above the LTS floor** reads or writes.

Why: the app cannot scale images (Alex, N1), so while `upgrade` steps an installation from N to
N+3 the N pods keep serving against every intermediate schema. They survive because each expand is
additive and nothing N touches is dropped (plan 6.7, 6.12). An LTS is named every six months (Alex,
N4), so a retired column lives up to a cycle before it may go.

This widens ADR-155 (`dev/docs/adr/155-migrations-are-never-breaking.md`), whose rule 2 says "one
full release later"; the amendment lands with S9 (plan 8).

## Route the request

| The request                                                            | Kind, mode (plan 6.1)                                         | Recipe                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Add, remove, rename, retype a Postgres column or table; `NOT NULL`     | `postgres-schema`, blocking                                   | `postgres-migration` skill                              |
| A relation between two Prisma models                                   | none: no `@relation`, no foreign key (Alex)                   | `postgres-migration` skill, "No foreign keys"           |
| Add, remove, retype a ClickHouse column, table or view                 | `clickhouse-schema`, blocking                                 | `clickhouse-migration` skill                            |
| Copy or reshape rows within one module's own tables, small, SQL only   | inline DML in the Prisma migration, blocking                  | `postgres-migration` skill (plan 6.11)                  |
| A batched move over a large table, SQL only, needed by the next schema | `data`, blocking, frozen SQL                                  | `migration-data-step` skill                             |
| A backfill that needs domain code, a peer `*Api` or object storage     | `data`, background                                            | `migration-data-step` skill                             |
| Historic values for a new ClickHouse column                            | `data`, background (`MATERIALIZE`), never an operator comment | `clickhouse-migration` skill (plan 6.12)                |
| Per-tenant move with a legacy path and a proof                         | `tenant`, background                                          | `migration-data-step` skill, "Tenant steps"             |
| Moving stored objects between providers, run on an operator's say      | `procedure`, operator                                         | `migration-data-step` skill, "Procedure steps"          |
| Retiring old data, a legacy path, a held tenant's source               | the contract half, under the floor rule                       | the schema skill, plus archive-or-fail (plan 6.8)       |
| A projection's shape changes                                           | a rebuild beside the old one, never an `ALTER`                | `postgres-migration` skill; `eventing-and-worker` skill |
| TTL, LangWatchQL provisioning, the access-config render                | reconcilers: run every `upgrade`, not steps                   | nothing to declare (plan 3.2 K3)                        |

## What a step is (plan 6.1)

One shape for every kind: an **id** (never reused; SQL steps use their file name, code steps
`<module>:<name>`), a **kind**, a **release** (stamped by the release PR, never by you, plan 6.3),
a **mode** (`blocking` runs inside `upgrade` at its release; `background` runs on the worker after
the last release; `operator` runs when asked, with arguments) and a **run** (the SQL file, or a
function with a checkpoint and one dry-run flag). The kind, mode and status enums are in
`@langwatch/upgrade` (S1, in progress).

**Who owns it** (Q3 = B): the module that owns the data declares its code steps with
`.withMigrations(...)` beside `.withTasks(...)`, built over its own repositories. Raw SQL against
its own tables goes only through its own `prisma.<subject>-migration.repository.ts`, the seam the
`prisma-migration-access` policy already polices. A move into another module's data goes through
that module's `*Api` or a fact, as any cross-module code does (§3.3). Schema SQL stays in the one
Prisma history and the one goose directory.

## How an upgrade runs (plan 6.4, 6.7)

`upgrade` reads the ledger, refuses an installation below the floor by name, then for each release
in turn: that release's Prisma folders, goose `up-to` its last version, its blocking steps, record.
Then the reconcilers. api and worker never migrate: they read the ledger and refuse by name when a
blocking step is outstanding. The worker then runs background and tenant steps in release order.
A fresh install applies all schema at once and marks every data, tenant and procedure step
`not-needed`, so **a data step is never the only way a fresh install gets correct data**: new
writers must write the new shape from the release that adds it.

## Never

- **Hold a boot.** No step runs in an api or worker start, and nothing waits without a deadline
  (plan 2, H1 to H3).
- **Wait on a held tenant.** A held tenant is a named, alerted failure; it blocks no boot, no floor
  and no cleanup (Alex, Q7; plan 6.8).
- **Edit a released step**, SQL or code. Write a new one (`specs/ci/migration-order.feature`).
- **Move data in place.** Copy to the new place, keep the old; deleting the old copy is a
  destructive step under the floor rule (plan 6.12, "Data step").
- **Write a down migration that runs.** The way back is the previous image on the new schema.

## Landed, and what to write today

The plan's slices (plan 8) land in order; until a row lands, write the right-hand column. This is
the §16 convention: the left names the target.

| Target (not landed yet unless marked)                             | Today                                                                                                               | Slice  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| Ledger tables beside `_prisma_migrations` and `goose_db_version`  | in progress in `@langwatch/upgrade`; nothing reads them yet                                                         | S1     |
| Release manifests stamped by the release PR; the named LTS floor  | none; no floor is declared in the tree                                                                              | S2, S9 |
| `pnpm task upgrade` (plan, status, run `<id>`)                    | `pnpm start:prepare:db` (`prisma-migrate clickhouse-migrate lwql-provision`), run by every api and worker start     | S3     |
| Version-by-version stepping                                       | everything applies at once, in each tool's own order                                                                | S4     |
| Tenant passes off the boot; `held:proof` / `held:pending`; alerts | `SystemMigration` passes, `migrated` is the held state (`packages/system-migrations/src/types.ts`)                  | S5     |
| `.withMigrations(...)`; per-owner tenant state                    | tenant steps answered through the owner's `registeredMigrations()` (§7); backfills as module tasks via `.withTasks` | S6     |
| Frozen-step lint rule and released-step immutability              | review by hand against the `migration-data-step` skill                                                              | S7     |
| Retirement note checked against the floor                         | the scanners check the note is present, not its release                                                             | S9     |

**Until a floor is declared**, a lane does not choose one. A contract step (drop, rename's last
step, `SET NOT NULL` on a populated column) is a question for the coordinator, naming the release
that stopped using the thing; write the expand and migrate halves now and leave the contract out.

## Links

`dev/docs/plans/migrations-rethink-2026-10-06.md` (6.1 shape, 6.4 order, 6.5 frozen SQL, 6.8 tenants,
6.12 window and recipes) · `dev/docs/adr/155-migrations-are-never-breaking.md` ·
`specs/ops/migration-safety.feature` · §7 ("Migrations are not the api's job") · the
`postgres-migration`, `clickhouse-migration` and `migration-data-step` skills.
