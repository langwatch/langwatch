---
name: migration
description: "Route any change to stored data, its schema or an event type to the step that ships it safely: add a column, drop a column or table, rename a column, table or event, change a type, make a column required, add an index or unique constraint, backfill, copy data to a new place, move to object storage, a tenant or system migration, retire a legacy path. Says which step kind and mode to write, which skill holds the recipe, the expand/contract rule and the LTS floor (3.20.1), what the linters and guard tests refuse, how `pnpm task upgrade`, the ledger and the serving gate run it, how to test it and what an operator sees. Use when someone says 'add a column', 'add a field', 'add a table', 'drop a table', 'drop the column', 'rename a column', 'rename an event', 'rename the pipeline', 'change the payload', 'change the type', 'make it NOT NULL', 'add an index', 'backfill', 'data migration', 'write a migration', 'migrate the data', 'tenant migration', 'system migration', 'withMigrations', 'withUpcasts', 'upcast', 'is this a breaking migration', 'LTS floor', 'pnpm task upgrade', 'the gate refuses', 'behind this image', or a migration guard test named their file."
user-invocable: true
argument-hint: "<the change: a schema edit, an event rename, a backfill, a tenant move, a retirement>"
---

# Migrations: which step, under which rule

Record: `dev/docs/ARCHITECTURE.md` §7 ("Migrations are not the api's job", "Upgrades run on deploy")
and §9 (the upcast paragraph); `dev/docs/adr/173-upgrades-run-on-deploy.md`; ADR-155 for the
window. Rulings: `.claude/coordinator/rulings-2026-10-06-rounds.md` rounds 8 to 23. This skill routes;
the recipes are in the skills it names.

## The one rule

**Every change is expand/contract inside the supported window.** The window is every release from
the **LTS floor** (`packages/upgrade/releases/lts-floor.json`, today `3.20.1`) to head. While
`upgrade` runs, and for the whole rollout after it, the previous image keeps serving on the new
schema, and a rollback puts an older image back on it. So:

- **Expand** (add a table, a nullable or defaulted column, a new event type, a new view name) ships
  in any release.
- **Migrate** (dual-write, backfill, upcast) ships with or after the expand.
- **Contract** (drop, rename's last step, type change's last step, `SET NOT NULL`, deleting an old
  copy) ships only once **no release at or above the floor** reads or writes what it removes,
  marked `-- contract: retired in <release>` with `<release>` at or below the floor. Cloud waits
  for the same floor (ADR-173, D8). A lane never moves the floor; a contract the floor does not
  yet allow is left out and named in the handoff.

## Route the request

| The request                                                 | Write                                                                                                                        | Skill                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Add, drop, rename or retype a Postgres column or table      | a Prisma migration (`postgres-schema`, blocking)                                                                             | `postgres-migration`                        |
| Make a column required, add a unique constraint or an index | a Prisma migration plus the pre-build note, or app-level enforcement                                                         | `postgres-migration`                        |
| Add, drop or retype a ClickHouse column, table or view      | a goose migration (`clickhouse-schema`, blocking)                                                                            | `clickhouse-migration`                      |
| A few rows fixed in your own tables, SQL only, small        | inline DML in the same Prisma migration                                                                                      | `postgres-migration`                        |
| A backfill, copy or reshape of existing data                | `defineMigrationStep` in `.withMigrations`, kind `data`, background                                                          | `migration-data-step`                       |
| Data the next release's schema cannot ship without          | the same, mode `blocking` (frozen SQL)                                                                                       | `migration-data-step`                       |
| Historic values for a new ClickHouse column                 | a background `data` step (`MATERIALIZE`), never an operator comment                                                          | `clickhouse-migration`                      |
| Per tenant, with a legacy path served until a proof passes  | kind `tenant`, background (a `SystemMigration`)                                                                              | `migration-data-step`                       |
| An operator-decided move (object storage provider)          | kind `procedure`, mode `operator`                                                                                            | `migration-data-step`                       |
| Rename or reshape an event type, aggregate or pipeline      | `.withUpcasts` on the owning pipeline; never rewrite the log first                                                           | `eventing-and-worker` ("Upcasts")           |
| A projection table's shape changes                          | a rebuild beside the old table, never an `ALTER`                                                                             | `postgres-migration`, `eventing-and-worker` |
| A read model over another module's events                   | a peer projection on your pipeline (`withPeerFoldProjection`); to change its shape, a new lane replayed from the owner's log | `eventing-and-worker` ("Peer projections")  |
| TTL, LangWatchQL provisioning, the access-config render     | nothing: reconcilers run on every `upgrade`                                                                                  | none                                        |

## Ids, owners and kinds

| Step                   | Id                                                  | Owner                                                        |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Prisma migration       | `prisma:<timestamp>_<slug>` (its folder name)       | the module whose repository claims every table it touches    |
| goose migration        | `clickhouse:<NNNNN>` (its sequence number)          | the module that owns every table it touches                  |
| `.withMigrations` step | `<module>:<kebab-name>`, the declaring module first | the declaring module; the collector refuses a foreign prefix |
| `.withUpcasts` entry   | `upcast:<pipeline>:<stored type>`, derived for you  | the pipeline that declares it                                |

One migration, one owner: the `migration-owners` policy refuses a SQL migration touching two owners'
tables (`pnpm lint:architecture --policies migration-owners`). Split it into one file per owner.
Ids are never reused and a merged migration is never edited (`specs/ci/migration-order.feature`).
Kinds and modes are `upgradeStepKindSchema` and `upgradeStepModeSchema` in
`packages/upgrade/src/ledger.ts`; only a `data` step may be `blocking`.

## How it runs

- `pnpm task upgrade [status | plan] [--json]` (`apps/tasks/src/upgrade.ts`) first creates the ledger
  in its own Postgres schema (`<schema>_upgrade_ledger`, round 21; a role without `CREATE` ends the
  run `schema_failed`), takes the runner lease there (ttl 60 s, renewed every 15 s, a second run
  waits 10 min), seeds an empty ledger, refuses an installation below the floor (exit 2), then walks
  the plan release by release: the release's schema, then its blocking steps; then the reconcilers.
  **A one-release upgrade applies its schema in one pass (`oneReleaseApplier`); a jump across
  several releases steps (`releaseSteppingApplier`, `apps/tasks/src/upgrade.ts`): each release's
  Prisma folders and goose `up-to` its last version, then its blocking steps, so a blocking step sees
  its own release's schema** (`specs/upgrade/stepping.feature`). Unreleased schema goes in one pass at
  the end. Write a blocking step as stepped (frozen SQL, its own release's columns). Postgres sessions carry `lock_timeout` (10 s) and a failed apply is attempted up to 3
  times (2 s, then 4 s). A Prisma migration newer than `RERUNNABLE_PRISMA_FROM` that fails (a
  `lock_timeout` cancel) is marked rolled back and retried, logged by name; an older one stops the
  run `failed_prisma_migration` naming the `prisma migrate resolve` command
  (`specs/upgrade/rerunnable-migrations.feature`). Exit codes: 0 done; 1 any failure
  (`failed_prisma_migration`, `rerunnable_migration_failed`, `schema_failed`, `step_failed`,
  `reconciler_failed`, `lease_lost`, `failed`); 2 below the floor; 3 lease not acquired
  (`packages/upgrade/src/runner/upgrade-outcome.ts`). Operator table: `docs/self-hosting/upgrade.mdx`.
- `pnpm start:prepare:db` (apps/api) is the one preparation script: `upgrade`, then the
  system-migrations pass. Every entry point runs it once (Helm pre-upgrade Job, the compose
  `migrate` service, the npx server, haven); on a Helm first install the api runs `upgrade` once
  itself (`specs/upgrade/entry-points.feature`).
- api and worker **never migrate**. Their serving gate refuses to start, by name, while a blocking
  step of their image is not `done` or `not-needed`, or their release is below the floor. ClickHouse
  steps always count: an install without ClickHouse refuses (round 20). Admitted, each writes a
  roster entry, refreshed every 15 s, stale after 60 s; a process whose own row lapses stops serving.
- Background steps run on the worker after the last release. A step with `needsOldWritersGone`
  waits until the serving roster says every live process declares it. A rollback is seen from the serving roster and
  reopens level-triggered background steps, so a re-upgrade re-runs them.
- A fresh install applies all schema at once and plans code and upcast steps by mode, so **a data
  step is never the only way new rows become correct**: writers write the new shape from the release
  that adds it.

## Landed and not landed (2026-10-07)

| Piece                                                                            | State                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Ledger, runner, `upgrade` / `upgrade status` / `upgrade plan`, manifests, floor  | landed (`packages/upgrade`, `apps/tasks/src/upgrade.ts`)                                                |
| Stepping applier (one release's schema at a time) in the real task               | landed for multi-release jumps (`releaseSteppingApplier`, `apps/tasks/src/upgrade.ts`)                  |
| Serving gate, first-install upgrade, roster 15 s / 60 s, rollback reopen         | landed (`packages/upgrade/src/gate`, `packages/upgrade/src/serving-roster`)                             |
| Prisma and ClickHouse guard scanners, floor check, lock-heavy refusals           | landed (`packages/*/src/__tests__/migration-safety.rules.ts`)                                           |
| `migration-order` CI check, `migration-owners` policy                            | landed (`cmd/migrationorder`, `packages/architecture-enforcer`)                                         |
| `defineMigrationStep` and `.withMigrations` collection (tasks, worker)           | landed (`packages/upgrade/src/step`, `packages/process/src/migration-steps.ts`)                         |
| The upgrade task running declared code steps; the worker running background ones | landed (`apps/tasks/src/upgrade.ts`, `packages/upgrade/src/background`)                                 |
| `.withUpcasts` read-time upcast and drain                                        | landed (`packages/eventing/src/upcast`)                                                                 |
| Upcast rewrite step, drain-age lint                                              | **not landed** (`@unimplemented` in `packages/eventing/specs/event-upcast.feature`)                     |
| Re-runnable migration guard rule and the runner's auto-resolve                   | landed (`rerunnable-migrations` policy; `packages/upgrade/src/stepping/rerunnable-migrations.ts`)       |
| No new foreign key or `@relation` (W-01)                                         | landed (`new-foreign-key` in `packages/prisma-client/src/__tests__/migration-safety.rules.ts`)          |
| Peer projections for cross-module read models                                    | landed (`packages/eventing/src/projections/peerProjection.ts`, `peer-projection.feature`)               |
| A lapsed roster entry turning `/readyz` 503 and pausing the worker               | landed for readiness and background steps; queue consumers pause once `packages/eventing` implements it |

## Never

- Run DDL or a step from an api or worker start, or wait without a deadline.
- Edit a merged migration or a released step; write a new one.
- Move data in place. Copy to the new place; deleting the old copy is a contract step.
- Write a down migration that runs. The way back is the previous image on the new schema.
- Rewrite stored events to rename a type. Upcast at read time; the copy comes later, at the floor.
- Add a foreign key or an `@relation` (Alex, 2026-10-06).

## Test it

| What                   | How                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Prisma or goose file | the scanner: `VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/prisma-client test src/__tests__/migration-safety.unit.test.ts` (or `@langwatch/clickhouse-migrations`) |
| A code step            | unit over memory twins: call `step.run` twice, dry run, old writer after the run (`migration-data-step` section 6)                                                  |
| An upcast              | unit over the pipeline (`packages/eventing/src/upcast/__tests__/eventUpcast.unit.test.ts`)                                                                          |
| The whole upgrade path | live suites: `apps/api/src/__tests__/live-upgrade.fixture.ts` runs `upgrade` once per test process on the test stores (`specs/upgrade/live-test-fixtures.feature`)  |
| Ownership and order    | `pnpm lint:architecture --policies migration-owners`; the `migration-order` workflow on the PR                                                                      |
| Re-runnable SQL        | `pnpm lint:architecture --policies rerunnable-migrations` (every Prisma folder newer than the marker)                                                               |

## What an operator sees

`pnpm task upgrade status` (and `npx @langwatch/server doctor`, which prints the same) shows one of
eight states: Unsupported, Needs attention, Upgrading, Never upgraded, Behind, Rolled back, Finishing
in background, Up to date. The Upgrades page (`/ops/upgrades`, platform operators only) lists each
release's steps with the **description** you wrote, and refreshes on the runner's read hint. Settings,
Checkup and `langwatch doctor` name pending or failed migrations with the fix. A refused process logs
the outstanding step ids and `pnpm task upgrade`. Operator docs: `docs/self-hosting/upgrade.mdx`.

On the console, every upgrade line carries `phase`, `waitingOn`, `elapsedMs` and `next` (the operator's
next action), and no line carries a password or token. A first run opens with a banner, says how many
migrations it applies before the api and worker serve, and ends with "first run finished in N ms". Each
phase logs its start and its end with its time; each blocking step is named before it runs and timed
after. A runner waiting for the lease names the holder every 30 s. The task's last line names the UI's
address from `BASE_HOST` and `pnpm task upgrade status`. A serving process logs its ledger check and
the time it took; a lapsed roster entry says readiness answers 503 and names the roster write it waits on (the worker's
background steps pause too); recovery says how long serving stopped.
