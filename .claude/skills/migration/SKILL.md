---
name: migration
description: "Route any change to stored data, its schema or an event type to the step that ships it safely: add a column, drop a column or table, rename a column, table or event, change a type, make a column required, add an index or unique constraint, backfill, copy data to a new place, move to object storage, a tenant or system migration, retire a legacy path. Says which step kind and mode to write, which skill holds the recipe, the expand/contract rule (no required stop), what the linters and guard tests refuse, how `pnpm task upgrade`, the ledger and the serving gate run it, how to test it and what an operator sees. Use when someone says 'add a column', 'add a field', 'add a table', 'drop a table', 'drop the column', 'rename a column', 'rename an event', 'rename the pipeline', 'change the payload', 'change the type', 'make it NOT NULL', 'add an index', 'backfill', 'data migration', 'write a migration', 'migrate the data', 'tenant migration', 'system migration', 'withMigrations', 'withUpcasts', 'upcast', 'is this a breaking migration', 'pnpm task upgrade', 'the gate refuses', 'behind this image', or a migration guard test named their file."
user-invocable: true
argument-hint: "<the change: a schema edit, an event rename, a backfill, a tenant move, a retirement>"
---

# Migrations: which step, under which rule

Record: `dev/docs/ARCHITECTURE.md` §7 ("Migrations are not the api's job", "Upgrades run on deploy")
and §9 (the upcast paragraph); `dev/docs/adr/173-upgrades-run-on-deploy.md`, which carries the
rulings of rounds 8 to 23. This skill routes; the recipes are in the skills it names.

- How the upgrade machinery itself works (ledger, gate, manifests, console, tests): the `upgrade` skill.

## The one rule

**Every change is expand/contract.** No release is a required stop on the way to the latest (Alex, 2026-10-11): an
install of any release pulls the latest image and the worker rolls it through every step, so every
step, alias and upcast is kept. While `upgrade` runs, and for the whole rollout after it, the previous image keeps serving on the new
schema, and a rollback puts an older image back on it. So:

- **Expand** (add a table, a nullable or defaulted column, a new event type, a new view name) ships
  in any release.
- **Migrate** (dual-write, backfill, upcast) ships with or after the expand.
- **Contract** (rename's last step, type change's last step, `SET NOT NULL`) waits until old writers
  are gone (`needsOldWritersGone`). A drop is not a migration at all: stop using the table or column
  (a release later its old writers are gone), then an operator drops it from Ops once safe. A
  `-- contract: retired in <release>` note records the release that stopped using it; it is history
  and never excuses a `DROP TABLE` or `DROP COLUMN` in a migration file (the guards refuse both).

## Route the request

| The request                                                              | Write                                                                                                                        | Skill                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Add, rename or retype a Postgres column or table                         | a Prisma migration (`postgres-schema`, blocking)                                                                             | `postgres-migration`                         |
| Make a column required, add a unique constraint or an index              | a Prisma migration plus the pre-build note, or app-level enforcement                                                         | `postgres-migration`                         |
| Add or retype a ClickHouse column, table or view                         | a goose migration (`clickhouse-schema`, blocking)                                                                            | `clickhouse-migration`                       |
| Stop using a table or column and remove it                               | stop reading and writing it; the drop is a separate operator step confirmed in Ops, never SQL in a migration                 | `postgres-migration`, `clickhouse-migration` |
| Rows of a table the same migration creates                               | inline SQL in that migration (an `UPDATE` or `DELETE` on an existing table is refused, however few rows)                     | `postgres-migration`                         |
| A backfill, copy or reshape of existing data                             | `defineMigrationStep` in `.withMigrations`, kind `data`, background                                                          | `migration-data-step`                        |
| Data the next release's schema cannot ship without                       | the same, mode `blocking` (frozen SQL; only tables created in the same release, never a sign-in or ingest table)             | `migration-data-step`                        |
| Historic values for a new ClickHouse column                              | a background `data` step (`MATERIALIZE`), never an operator comment                                                          | `clickhouse-migration`                       |
| Per tenant, with a legacy path served until a proof passes               | kind `tenant`, background (`defineMigrationStep` with `migrateTenant`)                                                       | `migration-data-step`                        |
| An operator-started move (object storage provider, credential resealing) | a named task outside the ledger, safe to run again (ARCHITECTURE.md §7)                                                      | `migration-data-step`                        |
| Rename or reshape an event type, aggregate or pipeline                   | `.withUpcasts` on the owning pipeline; never rewrite the log first                                                           | `eventing-and-worker` ("Upcasts")            |
| A projection table's shape changes                                       | a rebuild beside the old table, never an `ALTER`                                                                             | `postgres-migration`, `eventing-and-worker`  |
| A read model over another module's events                                | a peer projection on your pipeline (`withPeerFoldProjection`); to change its shape, a new lane replayed from the owner's log | `eventing-and-worker` ("Peer projections")   |
| TTL, LangWatchQL provisioning, the access-config render                  | nothing: reconcilers run on every `upgrade`                                                                                  | none                                         |

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

- `pnpm task upgrade [status | plan] [--json]` (`apps/tasks/src/upgrade.ts`; `status` and `plan` are
  read-only, the run itself is a run-once worker) first creates the ledger
  in its own Postgres schema (`<schema>_upgrade_ledger`, round 21; a role without `CREATE` ends the
  run `schema_failed`), takes the runner lease there (ttl 60 s, heartbeat every 15 s, a second run
  waits 10 min; `DEFAULT_LEASE_TIMING`, `packages/upgrade/src/runner/runner-lease.ts`), seeds an empty ledger, then walks
  the plan release by release: the release's schema, then its blocking steps; then the reconcilers.
  **A one-release upgrade applies its schema in one pass (`oneReleaseApplier`); a jump across
  several releases steps (`releaseSteppingApplier`, `packages/upgrade/src/runner/release-stepping-applier.ts`): each release's
  Prisma folders and goose `up-to` its last version, then its blocking steps, so a blocking step sees
  its own release's schema** (`specs/upgrade/stepping.feature`). Unreleased schema goes in one pass at
  the end. Write a blocking step as stepped (frozen SQL, its own release's columns). Postgres sessions
  carry `lock_timeout` (2 s, Alex, 2026-10-09) and a failed apply is attempted up to 3 times (2 s, then 4 s;
  `DEFAULT_LOCK_TIMEOUT_MS`, `DEFAULT_RETRY`, `packages/upgrade/src/runner/upgrade-runner.ts`). A Prisma migration newer than `RERUNNABLE_PRISMA_FROM` that fails (a
  `lock_timeout` cancel) is marked rolled back and retried, logged by name, unless it is one of
  the few named hand-applied folders; an older one stops the run `failed_prisma_migration`, and
  Retry on Ops > Upgrades (or a first install) may rerun it
  (`specs/upgrade/rerunnable-migrations.feature`). Exit codes: 0 done; 1 any failure
  (`failed_prisma_migration`, `rerunnable_migration_failed`, `schema_failed`, `step_failed`,
  `reconciler_failed`, `lease_lost`, `failed`); 3 lease not acquired
  (`packages/upgrade/src/runner/upgrade-outcome.ts`). Operator table: `docs/self-hosting/upgrade.mdx`.
- `pnpm start:prepare:db` (apps/api) is the one preparation script: `pnpm task upgrade` alone, no
  system-migrations pass. Local launchers (`pnpm dev`, haven) run it once before the lanes. In a
  deployment the **new image's worker runs the upgrade** at boot under the runner's lease; there is
  no compose `migrate` service, no npx migration phase, and Helm's pre-roll Job renders only with
  `serializeUpgrades` (`specs/upgrade/entry-points.feature`, UPGRADE-IN-WORKER).
- The **api never migrates** and holds nothing (NO-HOLDS): it serves every route and reports not
  ready until the ledger is current; a Postgres read ahead of the schema answers
  `upgrade_in_progress`, a ClickHouse read of a pending column goes through `ClickHouseColumns`. The worker takes no job until the ledger is current. ClickHouse
  steps always count: an install with a database and no ClickHouse refuses, naming `CLICKHOUSE_URL`
  (round 20; `NO_CLICKHOUSE_REFUSAL`). Admitted, each writes a
  roster entry, refreshed every 15 s, stale after 10 min. A roster blip never takes a process out
  of service: once admitted it serves until stopped.
- Background steps run on the worker after the last release, each on a queue list of its own so its
  jobs run ahead of any backlog (see `upgrade`). A step with `needsOldWritersGone`
  waits until the serving roster says every live process declares it. The ruling is that every step
  runs after old writers are gone; today the flag gates only where a step sets it, so set it. A rollback is seen from the serving roster and
  reopens level-triggered background steps, so a re-upgrade re-runs them.
- A background step that must follow another names it with `after: [copyStep]`, the step value, or
  across modules by its id, typed as the generated `CodeStepId` union, so a missing or mistyped step
  fails typecheck (Alex, 2026-10-09, STEP-AFTER, STEP-AFTER-2). A new step's id joins the union when
  you run `node --experimental-transform-types packages/upgrade/scripts/image-code-steps.ts`. The
  worker holds it `waiting` until each named step is `done` or `not-needed`. Only a background
  step runs after others (`after_not_background`). An unknown id or a cycle is refused at plan time
  (`step_after_unknown`, `step_after_cycle`).
- Nothing is deleted automatically (Alex, 2026-10-11): a drop is an operator step confirmed in Ops once safe.
  The upgrade never runs an operator step itself, and the migration-safety guards refuse a new
  `DROP TABLE` or `DROP COLUMN` in a migration file. Ops has no generic "start this operator step"
  action yet; until it does, stop using the data and leave the drop for that action.
- A fresh install applies all schema at once and plans code and upcast steps by mode, so **a data
  step is never the only way new rows become correct**: writers write the new shape from the release
  that adds it.

## Landed and not landed

| Piece                                                                                                    | State                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ledger, runner, `upgrade` / `upgrade status` / `upgrade plan`                                            | landed (`packages/upgrade/src/runner/upgrade-runner.ts`, `apps/tasks/src/upgrade.ts`)                                 |
| Stepping applier (one release's schema at a time) for multi-release jumps                                | landed (`releaseSteppingApplier`, `packages/upgrade/src/runner/release-stepping-applier.ts`)                          |
| Serving gate, first-install upgrade, roster refreshed every 15 s and stale after 10 min, rollback reopen | landed (`packages/upgrade/src/gate/serving-upgrade-gate.ts`, `SERVING_ROSTER_TIMING`)                                 |
| No ClickHouse configured refuses to serve                                                                | landed (`NO_CLICKHOUSE_REFUSAL`, `packages/upgrade/src/gate/serving-upgrade-gate.ts`)                                 |
| Prisma and ClickHouse guard scanners, retirement note, lock-heavy refusals                               | landed (`packages/{prisma-client,clickhouse-migrations}/src/__tests__/migration-safety.rules.ts`)                     |
| `migration-order` CI check, `migration-owners` policy                                                    | landed (`cmd/migrationorder/main.go`, `packages/architecture-enforcer/src/policies/index.ts`)                         |
| `defineMigrationStep` and `.withMigrations` collection                                                   | landed (`packages/upgrade/src/step/migration-step.ts`, `packages/process/src/migration/migration-steps.ts`)           |
| The upgrade task running declared blocking steps                                                         | landed (`app.migrationSteps(isDeclaredMigrationStep)`, `apps/tasks/src/upgrade.ts`)                                   |
| The worker running background steps after the serving roster allows it                                   | landed (`packages/upgrade/src/background/background-steps.service.ts`, `packages/process/src/process-server.ts`)      |
| `.withUpcasts` read-time upcast, drain, one ledger step per upcast                                       | landed (`packages/upgrade/src/ledger.ts`, `packages/eventing/specs/event-upcast.feature`)                             |
| Upcast rewrite step                                                                                      | **not landed** (three `@unimplemented` scenarios in `packages/eventing/specs/event-upcast.feature`)                   |
| Re-runnable migration policy and the runner's auto-resolve                                               | landed (`packages/upgrade/src/stepping/rerunnable-migrations.ts`)                                                     |
| No new foreign key or `@relation` (W-01)                                                                 | landed (`new-foreign-key` scanner rule; `packages/architecture-enforcer/tests/baselines/prisma-relations.json`)       |
| Projection replay steps and peer projections                                                             | landed (`packages/upgrade/src/step/projection-replay-step.ts`, `packages/eventing/src/projections/peerProjection.ts`) |

## Wrong first moves

What an agent reaches for first, and what to write instead:

- **Renaming an event type by rewriting `event_log`** or adding a new pipeline: declare
  `.withUpcasts` on the owning pipeline; the ledger step `upcast:<pipeline>:<stored type>` is derived.
- **`ALTER TABLE ... RENAME COLUMN` or `SET NOT NULL`** from `prisma migrate dev`'s default SQL:
  generate with `--create-only` and rewrite to expand/contract (`postgres-migration`).
- **A backfill as a one-shot task, a script or an operator comment**: a `defineMigrationStep` in
  the owning module's `.withMigrations`, `data`, `background` (`migration-data-step`). A re-run is
  Retry on the registered step in Ops, never a second task that calls the same code.
- **Several steps walking one table, or a `DROP` in a migration file**: one pass per table records
  every event it needs, in pages with `sendBatch`; a drop is an operator step, not SQL.
- **A blocking step that calls a service or the typed Prisma client**: blocking means frozen SQL
  through the owner's migration repository, or it is background.
- **Applying schema outside the ledger**: `pnpm prisma:migrate` and `pnpm clickhouse:migrate` are
  aliases of `pnpm task upgrade`; use that or `pnpm start:prepare:db`, never raw `prisma migrate`
  or `goose`.

## Never

- Run DDL or a step from module code at an api or worker start (the framework's own run-once path is the only boot-time upgrade), or wait without a deadline.
- Edit a merged migration or a released step; write a new one.
- Move data in place. Copy to the new place; deleting the old copy is an operator step.
- Write a down migration that runs. The way back is the previous image on the new schema.
- Rewrite stored events to rename a type. Upcast at read time; the optional rewrite is a later step.
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
seven states: Needs attention, Upgrading, Never upgraded, Behind, Rolled back, Finishing
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
the time it took.
