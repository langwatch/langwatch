# Migrations rethink: plan for Alex (2026-10-06)

Status: proposal. No code has changed. Nothing here is ruled until Alex answers section 9.
Ruling it answers: Q215, `.claude/coordinator/rulings-2026-10-05.md:168` ("rethink how migrations
work rather than restore the one task: version-aware, schema-aware, and no held or stuck runs. Big
work: plan it carefully first"). The question that prompted it is
`.claude/coordinator/questions-2026-10-06.md:264` (the unreachable `ObjectStorageMigrateTask`).

Every claim cites a file and line on this branch (or a commit on `origin/main` at `2687513eaa`).
Where a claim is an inference rather than an observation it says so.

## 0. Summary

Today "migrations" are eight different mechanisms with four locks, six entry points and no record
of which release an installation is on. Schema migrations run in order inside their own kind, but
nothing orders them against data migrations, half the data migrations are manual commands an
operator has to know about, and the per-tenant migrations have a `held` state with no exit.

The proposal, in five moves:

1. **One upgrade ledger** in Postgres that records every release an installation has upgraded to
   and every step that ran, of every kind (6.2).
2. **A release manifest** committed with each release: the ordered steps that release adds, each
   with its kind, its schema window and its preconditions (6.3).
3. **One `upgrade` entry point** that reads the ledger, computes the steps between the installed
   release and the image's release, and runs them release by release, across kinds (6.4, 6.9).
4. **Schema windows** on data steps: a step runs only while the schema is between the expand that
   made it possible and the contract that makes it obsolete, a fresh install records it as not
   needed, and a supported-upgrade floor lets old steps and old migrations be deleted (6.5).
5. **No unbounded waits**: a pod whose release is already applied takes no lock; the lock that
   remains is a visible lease with a bounded wait; DDL carries a `lock_timeout`; tenant migrations
   never hold a boot, and a held tenant always has an age, a reason and an alert (6.7, 6.8).

## 1. Goals

From Alex's words, each made checkable:

- **G1 Version-aware.** An installation on release N upgraded straight to N+3 runs exactly the
  steps of N+1, N+2 and N+3, in release order, with each release's data steps finished before a
  later release's contract step that depends on them. Check: an integration test that migrates a
  database recorded at N to N+3 and asserts the ledger order.
- **G2 Schema-aware, so old ones can be cleaned up.** A step declares the schema it needs and the
  schema at which it stops being needed; the runner skips it outside that window; a fresh install
  runs none of the historical data steps; and a step older than the supported-upgrade floor can be
  deleted from the tree without breaking any supported upgrade. Check: a fresh-install test records
  every historical data step as `not-needed`; a floor test refuses an upgrade from below the floor
  by name.
- **G3 No held or stuck runs.** No process waits without a deadline; no step can be left
  half-applied without the next run knowing; no tenant stays held without a reason, an age and an
  alert. Check: section 2's four senses each get a scenario.

Derived goals (needed to meet the three above):

- **G4 One entry point.** api, worker, the Helm pre-roll Job, the npx server, compose and haven all
  call the same command (today they call five different chains, 3.1).
- **G5 Observable.** An operator can answer "what release is this database on, what ran, what is
  outstanding, what is held and why" from the ops page and from one CLI command.
- **G6 Keeps ADR-155.** Expand/contract, one release between stop-using and drop, no down
  migrations, the pre-roll gate (`dev/docs/adr/155-migrations-are-never-breaking.md:30-66`).

Non-goals: replacing Prisma or goose as SQL appliers; down migrations; changing what any existing
migration does; the object-storage provider migration's own phases (it is an operator procedure,
6.1 K7, and keeps them).

## 2. What "held" means, precisely

The word is used for four different things in the tree. The plan treats each separately.

**H1 Tenant held.** A per-tenant system migration whose work ran but whose own proof disagreed:
outcome status `migrated` (`packages/system-migrations/src/types.ts:41-48`, "`migrated` is the held
state ... the tenant stays on its legacy path until a later pass's proof passes"). It is re-counted
every pass and never counts as progress (`types.ts:72-77`). Nothing ages it or alerts on it; the
upgrade guide tells operators to look at Ops > Migrations themselves (`docs/self-hosting/upgrade.mdx:20-28`).
Also held: work the boot preflight queued that has not drained, which leaves the tenant `migrated`
(`specs/migration/system-migrations-runner.feature:186-210`, commit `d7f39800b5`, #8249).

**H2 Boot held.** A process that cannot start because the startup migration loop does not end.
Seen three times on main within days:

- #8244 (`73d814c1b2`): the secret-heal cohort became every user; two mandatory passes overran the
  startup probe; every replica in CrashLoopBackOff. Then peers' leases read as `claimed`, so
  `advanced: 0`, `claimed` climbing 100 to 1243, 25 passes, preflight failure, crash loop.
- #8247 (`9f320b52e7`): every pass enumerated every tenant; 9,004 users, 4m43s a pass, two passes
  mandatory, fleet crash-looped.
- #8249 (`d7f39800b5`): the drain barrier waited on a group whose claim outlived its dead worker;
  `pending` climbing 32 to 50 across boots, every replica crash-looping on one group id.
  Each was fixed by teaching the loop a new exception. The shape that produced them (a convergence
  loop inside every replica's boot) is still there: `packages/system-migrations/src/convergence.ts:206-238`
  (25 passes, `MAX_PASSES` at `:42`, 5 s apart at `:35`) runs from `start:prepare:db` on every api and
  worker start (`apps/api/package.json:19`, `apps/worker/package.json:20`).

**H3 Lock held.** A runner waiting on another runner's lock with no deadline:

- `apps/tasks/src/migration-lock.ts:19-27` tries `pg_try_advisory_lock`, then blocks on
  `pg_advisory_lock` with no timeout.
- `apps/tasks/src/main.ts:59-64` takes that lock around the WHOLE chain whenever any task in it needs
  the database, so `system-migrations-pass` (up to 25 passes) runs under it, and the test pins that
  (`apps/tasks/src/__tests__/main.unit.test.ts:71-74`, order `lock, prisma, clickhouse, lwql, system,
unlock`). The task's own header says the opposite: "No migration lock: the pass leases per tenant"
  (`apps/tasks/src/system-migrations-pass.ts:2-4`), and `LOCK_FREE_TASKS` (`main.ts:38`) only helps
  when the pass runs alone. Inference: every replica after the first waits for the first replica's
  entire convergence loop, and a no-op second pass still queues on the lock.
- No migration session sets `lock_timeout` or `statement_timeout` (no match for either in
  `apps/tasks`, `packages/prisma-client`, `packages/clickhouse-migrations`). Inference: a DDL that needs
  an `ACCESS EXCLUSIVE` lock behind a long query queues every later query on that table behind it.
  Not observed in an incident; a standard Postgres hazard.

**H4 Half-run.** A step that stopped part way and leaves the next run unable to tell:

- Prisma marks a failed migration failed and refuses later deploys until someone runs
  `prisma migrate resolve`; our task reports only "prisma migrate deploy exited with code N"
  (`apps/tasks/src/prisma-migrate.ts:27`). Nothing in the tree mentions `migrate resolve` (searched).
- goose on ClickHouse has no transactions; a statement that ran before a failure is not recorded in
  `goose_db_version`, so the re-run repeats it. One statement per block
  (`dev/docs/adr/155-migrations-are-never-breaking.md:49-50`) narrows this, it does not close it.
- Manual backfills keep no record of having run (3.2 K4); an interrupted run is visible only in a
  log line.

Also not "held" but often confused with it: **gated** migrations that ship inert on self-hosted until
a later release flips them (`runsAutomaticallyOnSelfHosted = false`, e.g.
`modules/identity/process/src/services/system-migration-identity-identifier-backfill.service.ts:25`
and `system-migration-identity-secret-heal.service.ts:24`). They are a release act, which the manifest
models directly (6.3).

## 3. Current state

### 3.1 Entry points that migrate

| Entry                  | What it runs                                                                                        | Evidence                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| api container start    | prisma-migrate, clickhouse-migrate, lwql-provision, system-migrations-pass, under one advisory lock | `apps/api/package.json:19-20`, `infra/docker/Dockerfile:299-316`                |
| worker container start | the same chain                                                                                      | `apps/worker/package.json:19-20`, `infra/docker/Dockerfile:314-315`             |
| Helm pre-roll Job      | `start:prepare:db` on the new image, `pre-upgrade` only, one attempt, 2100 s deadline               | `charts/langwatch/templates/app/migrate-pre-roll-job.yaml:47-75,113`            |
| npx server             | prisma-migrate, then clickhouse-migrate; no lwql-provision, no system pass                          | `apps/server/src/services/migrate.ts:53,60`                                     |
| compose dev            | `prisma migrate deploy` directly (no advisory lock), then clickhouse-migrate                        | `dev/compose.dev.yml:308-309`                                                   |
| pnpm dev / haven       | `start:prepare:db` once before the lanes                                                            | `dev/scripts/dev-stack.sh:256`, `tools/thuishaven/app/orchestrator.go:621`      |
| CI workflows           | clickhouse-migrate or prisma-migrate alone                                                          | `.github/workflows/e2e-ci.yml:290`, `.github/workflows/gateway-matrix.yaml:219` |

The record says migrations are tasks run before serve by the start script and the deploy pipeline
(`dev/docs/ARCHITECTURE.md:1297-1305`). It does not say every replica runs them.

### 3.2 The eight kinds

**K1 Postgres schema.** 363 Prisma migration folders, timestamp-keyed, in
`packages/prisma-client/prisma/migrations` (`0_init` to `20261002120016_user_notification_preferences`).
Applied by `prisma migrate deploy` (`apps/tasks/src/prisma-migrate.ts:18`). 67 of them carry inline
`UPDATE`/`INSERT`/`DELETE` data steps (counted with `git grep -c`), so data moves already ride inside
schema migrations.

**K2 ClickHouse schema.** 95 goose files, sequence-keyed, in `packages/clickhouse-migrations/migrations`,
applied with `goose up` (`packages/clickhouse-migrations/src/goose.migration-runner.ts:824`); the runner
already accepts `up-to` (`:720`). Gaps in the sequence after 41, 67, 70, 78 and 90. goose runs only
above the recorded version (`.claude/skills/clickhouse-migration/SKILL.md:23-26`). Several migrations
leave a historical backfill to the operator in a comment ("MATERIALIZE INDEX can be run via ...":
`00034_add_query_pruning_indexes.sql:26`, `00035_...:28`, `00062_...:36`, `00063_...:29`,
`00076_gateway_spend_filter_indices.sql:41-43`); nothing records whether anyone did.

**K3 Convergent reconcilers, every boot.** The TTL reconciler inside clickhouse-migrate
(`packages/clickhouse-migrations/src/ttl.reconciler.ts:488-532`, metadata-only `MODIFY TTL`),
LangWatchQL provisioning (`apps/tasks/src/lwql-provision.ts:22`), the access-config render. They
compare desired with actual state and are not versioned. This kind is healthy and stays.

**K4 Installation-wide data migrations (backfills).** Manual module tasks run with
`pnpm task <name>`; nothing runs them on upgrade and nothing records them. From the 30 module tasks
(`modules/*/process/src/tasks/*.task.ts`), the ones that move or derive data:
`backfill-http-agent-credentials-to-secrets`, `backfill-http-credentials-to-secrets`,
`backfill-annotations-to-clickhouse`, `agent-audit-log-ids-backfill`, `report-schedule-backfill`,
`dataset-content-backfill`, `virtual-key-config-backfill`, `model-provider-migrate-credentials`,
`model-provider-migrate-custom-models`, `backfill-organization-presence-setting`,
`backfill-project-created`, `backfill-project-presence-setting`, `stalled-runs-backfill`,
`tiered-free-to-seat-event`. Their conventions differ: `--dry-run` opts out of writing
(`modules/audit-log/process/src/tasks/agent-audit-log-ids.task.ts:13-14`), gateway's defaults to a dry
run (`modules/gateway/process/src/tasks/virtual-key-config-backfill.task.ts:46,89`), others have no
dry run. One is already schema-aware: the dataset backfill returns `schema-pending` and skips when its
columns are missing (`modules/dataset/process/src/services/dataset-migration.service.ts:38`,
`.../repositories/prisma/prisma.dataset-migration.repository.ts:147`). That is the precedent for 6.5.
The upgrade guide says the dataset move is "a one-time automatic migration on upgrade"
(`docs/self-hosting/upgrade.mdx:284`) while its own page says the chart does not run it and the
operator must (`docs/self-hosting/upgrade-dataset-storage.mdx:15,118-128`).

**K5 Per-tenant system migrations.** `packages/system-migrations` (runner, convergence, lease, state
ports); ops owns the runner, the subjects own the migrations and answer them through their `*Api`
(`dev/docs/ARCHITECTURE.md:1307-1314`). Registered, in main's order
(`modules/ops/process/src/services/system-migration-pass.service.ts:447-453`): authz grant import,
identity SSO connection grandfather and SSO domain ownership
(`modules/identity/process/src/app/identity.app.ts:1077-1085`), automation Slack connections; user-rooted:
identity identifier backfill and secret heal (`identity.app.ts:1070-1075`). State: `SystemMigrationTenantState`
and `SystemMigrationEnrollment` (`packages/prisma-client/prisma/schema.prisma:6240-6273`); statuses
`migrated | finalized | parked | rolled_back` (`types.ts:6-11`). Re-drive: an hourly scheduled process
manager (`modules/ops/process/src/eventing/ops-system-migrations.pipeline.ts:66`, record `:1785-1790`).
Two dead paths: `SystemMigrationPassService.runStartup` (`system-migration-pass.service.ts:108-142`) has
callers only in tests, so the `executionMode: "startup"` declaration
(`packages/system-migrations/src/system-migration.ts:11`) does nothing in production; and
`ClickHouseImportStoredObjectMigration`, the one migration that declares it
(`modules/stored-object/process/src/migrations/clickhouse-import.stored-object.migration.ts:42-52`), is
registered by no module and does not exist on main.

**K6 Projection rebuilds.** `ReplayService` (`packages/eventing/src/replay/replayService.ts:40`), driven
by ops (`modules/ops/process/src/services/replay.service.ts`); ADR-155 rule 6 makes a projection change a
rebuild beside the old one (`adr/155...:56-60`). Operator-triggered; no upgrade records one.

**K7 Operator procedures.** The object-storage provider migration, four phases
(`modules/stored-object/process/src/tasks/object-storage-migrate.task.ts:93,304-307`), registered by no
module (`stored-object.module.ts` has no `.withTasks`), and its inventory port has no implementation
(questions file `:264`). It is not an upgrade step: it moves a live installation between providers on
an operator's schedule, with paused traffic (main's header, `platform/app/src/tasks/migrateObjectStorage.ts:1-14`
on `origin/main`). Other operator tools (reports, syncs, purges, `grant-platform-operator`,
`user-data-erase`, demo data) are the same kind.

**K8 One-time latches as process managers.** The operator bootstrap seed runs once behind a marker
(`dev/docs/ARCHITECTURE.md:1462-1476`; `modules/ops/process/src/eventing/ops-platform-operator-seed.pipeline.ts:44,62`).
A one-time upgrade act implemented as a scheduled wake that latches.

### 3.3 Locks

| Lock                                          | Scope                             | Wait                        | Evidence                                                   |
| --------------------------------------------- | --------------------------------- | --------------------------- | ---------------------------------------------------------- |
| Postgres advisory lock `langwatch:migrations` | installation, session-scoped      | unbounded                   | `apps/tasks/src/migration-lock.ts:3-27`                    |
| ClickHouse schema lock                        | one host: a file in `os.tmpdir()` | 110 s, sized for test files | `packages/clickhouse-client/src/schema-lock.ts:27-36`      |
| Tenant leases (Redis)                         | per tenant per pass               | none, fails safe to "held"  | `packages/system-migrations/src/lease.repository.ts:6-15`  |
| Drain barrier                                 | preflight queue groups            | deadline, then gives up     | `specs/migration/system-migrations-runner.feature:186-210` |

Across pods, ClickHouse migrations are serialised only because they run inside the Postgres advisory
lock (commit `0b5f84cf0c`, #8313, "the migrate task now holds a Postgres advisory lock for the whole
run"). The file lock does nothing between two pods.

### 3.4 What records exist

`_prisma_migrations` (Prisma), `goose_db_version` (goose, pre-created at
`goose.migration-runner.ts:583-607`), `SystemMigrationTenantState` (K5). Nothing records the release.
The release number lives in `.github/.release-please-manifest.json` (`".": "3.20.1"`) and is written into
`apps/api/package.json:3` and `charts/langwatch/Chart.yaml:5-6`; no process reads it at migration time.
ADR-155's contract note names a release (`-- contract: retired in 1.42.0`, `adr/155...:61-66`), but no
migration in either tree carries one yet (searched both directories).

## 4. Failure modes, seen and latent

| #   | Failure                                                                                        | Seen?                                    | Evidence                                                                |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| F1  | Boot loops on tenant migrations crash-loop the fleet                                           | seen x3                                  | #8244, #8247, #8249 (section 2, H2)                                     |
| F2  | Two pods apply the same ClickHouse migration; one crash-loops on TABLE_ALREADY_EXISTS          | seen                                     | `specs/clickhouse/concurrent-boot-migrations.feature:1-6`, `0b5f84cf0c` |
| F3  | ClickHouse not up yet; bootstrap dies on ECONNREFUSED; every new install restarts once         | seen                                     | `e494045ab0` (#8326)                                                    |
| F4  | Every replica after the first waits for the first's whole chain, including the system pass     | inferred                                 | `main.ts:59-64`, `main.unit.test.ts:71-74`                              |
| F5  | A skipped-version upgrade runs a later contract before an earlier release's data move          | latent; first contract step will hit it  | 6.9; no contract note in tree yet                                       |
| F6  | Manual backfills never run on self-hosted, or run while old pods still write                   | latent, documented as an operator burden | `upgrade-dataset-storage.mdx:118-128`                                   |
| F7  | A failed Prisma migration blocks every later boot until a manual resolve, with a generic error | latent                                   | `prisma-migrate.ts:27`                                                  |
| F8  | Held tenants stay on legacy paths indefinitely with no alert; legacy code can never be deleted | ongoing                                  | `types.ts:41-48`, `upgrade.mdx:20-28`                                   |
| F9  | Entry points drift: npx server skips lwql and the system pass; compose bypasses the lock       | ongoing                                  | 3.1                                                                     |
| F10 | A long-running branch and main number migrations independently                                 | ongoing                                  | below                                                                   |

F10 in numbers: main's newest Prisma migration `20261002090000_join_request_origin` is not on this
branch yet, and three branch-only migrations sort below it (`20261001130000_authz_user_standing`,
`20261001140000_gateway_trace_export_key`, `20261001150000_api_key_system_managed`). ClickHouse: the
branch adds `00101` to `00104` above main's `00100`; the next main ClickHouse migration will collide on
`00101`. `tools/migrationorder/set.go:40-66` checks PRs against the base branch, so it cannot see this
between two long-lived lines. The first release cut from this branch is itself a multi-version upgrade
for every installation on main's 3.20.x.

## 5. Contradictions to fix whatever is decided

1. `specs/setup/schema-migrations-on-start.feature:68` ("the worker never migrates; exactly one
   migrator") against `apps/worker/package.json:19-20` and `Dockerfile:314-315` (the worker runs the
   same chain).
2. `specs/migration/system-migrations-runner.feature:323` ("a pass that fails outright ends the task
   without failing the boot chain") against `:326` ("A failed pass prevents startup"). The code
   follows the first (`convergence.ts:247-260` swallows); the second is bound to the unused
   `runSystemMigrationsAtStartup` (`startup-convergence.unit.test.ts:182`).
3. `specs/migration/system-migrations-runner.feature:167-169` are steps orphaned after a comment block,
   appended to the previous scenario.
4. `apps/tasks/src/system-migrations-pass.ts:2-4` ("No migration lock") against `main.ts:59-64`.
5. `charts/langwatch/templates/NOTES.txt:184,241` describe a dataset-migration Job that exists in no
   template, here or on main.
6. `docs/self-hosting/upgrade.mdx:284` ("automatic") against `upgrade-dataset-storage.mdx:15` (manual).

## 6. Target design

### 6.1 Vocabulary

- **Release**: a released version (`3.21.0`). The image knows its own release at build time.
- **Step**: one unit the upgrade runs. Kinds: `pg-schema` (K1), `ch-schema` (K2), `data` (K4, and the
  operator-comment backfills of K2), `tenant` (K5), `reconcile` (K3). K6 rebuilds become `data` steps
  when a release needs one; K7 procedures stay operator tasks outside the upgrade; K8 latches become
  `data` steps with no tenant axis.
- **Schema position**: the pair (newest applied Prisma migration, newest applied goose version).
- **Window** of a data step: `after` (the expand migration it needs) and `obsoleteAt` (the contract
  migration that removes its source).
- **Floor**: the oldest release this image can upgrade from.
- **Required stop**: a release an upgrade must pass through with its blocking steps complete before
  any later release's steps run.

### 6.2 The upgrade ledger

One table set in Postgres, written only by the upgrade runner:

- `upgrade_release`: one row per release this installation upgraded to: release, started, finished,
  outcome, image digest.
- `upgrade_step`: one row per step: release, kind, name, status
  (`pending | running | done | not-needed | failed`), started, finished, attempt, last error, report.

Prisma's and goose's own tables stay the truth for their SQL; the ledger mirrors them per release so
one query answers "what ran in which release". K5 keeps `SystemMigrationTenantState` for per-tenant
truth; the ledger holds the migration-level summary (how many tenants finalized, held, parked).

On first run against an existing installation, the ledger is seeded from the schema position: the
newest release whose manifest's schema position is at or below the database's is recorded as the
installed release, marked `inferred`. Ownership of these tables is open (6.11, question Q4).

### 6.3 The release manifest

A committed file per release (shape, not a format decision): the steps the release adds, in order.
Generated, not hand-written, for the schema kinds: the generator lists the Prisma folders and goose
files added since the previous release tag, so a reviewer only writes the data and tenant entries.
Each data entry names its owner module, its window, whether it is `blocking` (must finish before
serve and before any later release's steps) or `background` (runs on the worker), and any
`requires` (a data step that must be `done` first). A contract migration must name, in its
`-- contract: retired in <release>` note, the release that stopped using the thing; CI checks the
named release is at least one release older (ADR-155 rule 2) and that every data step whose window
ends at this contract is in an earlier release. The `runsAutomaticallyOnSelfHosted` flip becomes a
manifest entry of the release that flips it, so a self-hosted install that skips that release still
gets the flip.

### 6.4 Ordering across kinds

Within one release: `pg-schema` expands, `ch-schema` expands, `blocking` data steps, `reconcile`, then
serve; `background` data and `tenant` steps after serve, on the worker. Contract migrations of a
release run after that release's blocking data steps, never before (today all of Postgres runs before
all of ClickHouse before any data step: `main.ts:22-35` with the chain order in
`apps/api/package.json:19`).

Across releases: release by release. To stop Prisma at a release boundary the runner applies Prisma
with a migrations directory holding only the folders up to that release (the Prisma config already
names the path, `apps/tasks/prisma.config.ts`), and goose with `up-to <version>` (already supported,
`goose.migration-runner.ts:720`). Inference to verify in slice 4: `prisma migrate deploy` over a
subset directory leaves `_prisma_migrations` consistent for the next subset.

### 6.5 Schema awareness, fresh installs and cleanup

- A data step runs only inside its window. Before `after` it is not yet possible (today's
  `schema-pending`, generalised); at or past `obsoleteAt` its source is gone, so it is recorded
  `not-needed` if it never ran and an error if it is still `pending` (that is F5, refused by name
  instead of silently skipped).
- A fresh install creates the schema at the image's release and records every data and tenant step of
  every earlier release as `not-needed`: there is nothing to move.
- **Floor and cleanup.** The image declares its floor. Below it, `upgrade` refuses by name ("upgrade
  to <floor> first"). Any data step whose window closes at or before the floor's schema position can be
  deleted from the tree, with the legacy read path it served; any tenant migration whose release is
  below the floor and that every supported installation has finalized can be deleted with its legacy
  path. That is the cleanup Alex asked for: it becomes a mechanical rule rather than a judgement.
- **Squash.** With a floor, the Prisma history below it can be squashed into a new baseline
  (Prisma's documented baselining: one `0_init` from the floor's schema, `migrate resolve --applied` on
  existing databases) and goose likewise. 363 and 95 files become one each plus what came after.
  Optional, after the floor exists.

### 6.6 Idempotency and half-run rules

- Every data step is idempotent and checkpointed: it records progress in its `upgrade_step.report`
  and resumes from it; a dry run is one flag with one meaning across all steps.
- No new DML inside a schema migration: a new migration-safety rule beside the existing scanner
  (`packages/prisma-client/src/__tests__/migration-safety.rules.ts`,
  `packages/clickhouse-migrations/src/__tests__/migration-safety.rules.ts`); data moves become data
  steps. The historical ones stay baselined.
- ClickHouse DDL uses `IF NOT EXISTS` / `IF EXISTS` forms so a repeated statement after a half-run is a
  no-op (a further scanner rule).
- A failed Prisma migration is detected before `deploy` (read `_prisma_migrations` for a row with
  `finished_at` null and `rolled_back_at` null) and reported with its name and the exact resolve
  command, instead of "exited with code N".

### 6.7 Locking without holds

- **Fast path, no lock.** Every boot reads the ledger first. If this image's release is recorded
  `done` (and no blocking step is outstanding) the process skips the upgrade entirely: no lock, no
  pass. This turns the pre-roll Job's "idempotent second pass" (`migrate-pre-roll-job.yaml:25-27`) into
  a read.
- **One lease, visible.** The upgrade takes an installation lease row (owner, image release, host,
  heartbeat, expiry) instead of a blocking advisory lock. A waiter logs who holds it and for which
  release, waits up to a deadline, then exits non-zero with that holder named. A dead holder's lease
  expires. The advisory lock can stay underneath for mutual exclusion; what changes is that nobody
  waits on it without a deadline.
- **DDL timeouts.** Migration sessions set `lock_timeout` (seconds) and retry with backoff, so DDL
  never queues application traffic behind it.
- **ClickHouse under the same lease**; the file lock stays for tests only.
- **Tenant passes leave the boot.** `tenant` steps run on the worker's scheduled process manager
  (exists) and never in `start:prepare:db`; a release that needs a tenant migration finished before a
  contract makes it a `requires` of that contract (6.3), not a boot wait.

### 6.8 Tenant migrations: no silent holds

- The held state splits by reason: `held:proof` (the proof disagreed; needs a repair or a decision)
  and `held:pending` (work queued, not drained; resolves on its own). Today both are `migrated`
  (`types.ts:41-48`).
- Every held row carries `heldSince`; ops raises an alert past a threshold, and the ops page sorts by
  age.
- A migration declares an end: either it finalizes every tenant, or it is `recurring`
  (`startupSettlement`, `system-migration.ts:13`) and never gates a contract. A finite migration with
  tenants held past its release's floor blocks the floor from moving, by name, so legacy code cannot
  be deleted under a held tenant.

### 6.9 Self-hosted upgrade across versions, walked through

Installation on 3.20 (inferred from schema), image 3.23, floor 3.19:

1. Boot (or the pre-roll Job) reads the ledger: installed 3.20, image 3.23. Not done, so take the lease.
2. Refuse if 3.20 is below the floor (it is not).
3. For 3.21, then 3.22, then 3.23: apply that release's Prisma folders and goose versions, run its
   blocking data steps, record each step.
4. A 3.22 contract that drops a column the 3.21 data step reads would run only after the 3.21 step is
   `done`; today it would run in the single `prisma migrate deploy` before any data step.
5. Release the lease; record 3.23 done. Every other pod takes the fast path.
6. The worker runs the background and tenant steps; the ops page shows them per release.

### 6.10 Observability

- `pnpm task upgrade status`: installed release, image release, floor, steps outstanding by release.
- `pnpm task upgrade plan`: what an upgrade would run, without running it (the pre-roll Job prints
  this first, so a failed Job's log starts with the plan).
- The ops migrations page (exists for K5, `docs/self-hosting/upgrade.mdx:43-48`) gains the release
  history and the data steps.
- Metrics: step duration, oldest held tenant age, held and parked counts.

### 6.11 Where it lives (not chosen)

The record puts schema migrations in apps/tasks by hand, before any module boots, allowed to name
process packages and touch the stores directly (`dev/docs/ARCHITECTURE.md:819-825,1297-1305`), and
puts the tenant runner in ops with each subject answering through its `*Api` (`:1307-1314`). Data
steps today are module tasks (`.withTasks`). The design needs one new declaration: how a module
declares a data step with its window. Options are in question Q3; this plan does not pick one.

## 7. Migration path

The redesign lands beside today's machinery and replaces it one entry point at a time. Nothing is
renumbered, nothing already applied runs again.

1. Ledger tables land, written read-only from today's runs (seeded from schema position).
2. `upgrade status/plan` read the ledger; no behaviour change.
3. `upgrade` replaces `start:prepare:db` in all entry points (3.1) at once, with the fast path and the
   lease; it runs today's chain in today's order, so behaviour only changes by not waiting.
4. Tenant passes leave `start:prepare:db`.
5. Data steps become declared; the manual backfills in 3.2 K4 move over one owner at a time; each keeps
   its task name as an operator re-run.
6. Release-by-release ordering switches on, then the floor, then cleanup and squash.

## 8. Phased slices

Each slice is lane-sized, has its own scenario and lands green on its own.

- **S0 (now, independent of the redesign; each needs only Alex's yes in Q8):**
  S0.1 fix the five spec/doc contradictions of section 5 as behaviour questions;
  S0.2 take `system-migrations-pass` out of the advisory lock (`main.ts:38,59-64`, flip the test at
  `main.unit.test.ts:73`);
  S0.3 bounded wait on the advisory lock that names the holder (`migration-lock.ts:26`);
  S0.4 `lock_timeout` on migration sessions;
  S0.5 rule on the dead paths: `runStartup` and the startup execution mode, the unregistered
  `ClickHouseImportStoredObjectMigration`, and the unregistered `ObjectStorageMigrateTask` (Q215's
  original question, `questions-2026-10-06.md:264`).
- **S1** ledger tables and seeding from schema position; integration test against the local Postgres.
- **S2** `upgrade status` and `upgrade plan`; manifest generator for the schema kinds from release tags.
- **S3** `upgrade` entry point with fast path and lease; repoint api, worker, Helm Job, npx server,
  compose, haven and CI; delete the five chains.
- **S4** release-by-release application (Prisma subset directory, goose `up-to`); the N to N+3 test.
- **S5** tenant passes off the boot; held reason split, `heldSince`, ops alert.
- **S6** data-step declaration (after Q3) and the first two backfills converted
  (`dataset-content-backfill`, already schema-aware, and one small one such as `backfill-project-created`).
- **S7** remaining backfills; scanner rules for DML in schema migrations and idempotent ClickHouse DDL;
  the commented ClickHouse backfills become data steps.
- **S8** contract preconditions in CI; the floor; refusal below it.
- **S9** squash below the floor; delete obsolete data steps and their legacy paths.

## 9. Open questions for Alex

1. **Q1 Interpretation.** Is "schema aware, run only up to where needed, so we can clean up" what 6.5
   describes (windows, fresh installs skip history, a floor that lets old steps be deleted)? Or did you
   mean something narrower, such as only squashing migrations?
2. **Q2 Floor policy.** How far back must a self-hosted install be able to upgrade in one go: a fixed
   number of minor releases, a named long-term release, or anything since 3.0? Below it, refuse
   ("upgrade to X first") or step through automatically?
3. **Q3 How a module declares a data step.** (a) extend `SystemMigration` with an installation scope and
   keep the existing `registeredMigrations()` `*Api` operations; (b) a new `.withMigrations(...)` module
   declaration beside `.withTasks`, run by apps/tasks over the booted tasks container (no new `*Api`
   operation, a framework change in `packages/process`); (c) keep plain tasks and list their names in
   the manifest. The lane leans to (b); it is a new pattern, so yours.
4. **Q4 Ledger ownership.** Infrastructure tables beside `_prisma_migrations` and `goose_db_version`,
   owned by the runner and outside the catalogue, or ops' tables (ops already owns
   `SystemMigration*`)? apps/tasks writes them before any module boots.
5. **Q5 Who migrates.** Should only the pre-roll Job (and first boot) migrate, with api and worker
   verifying the ledger and refusing if behind, or keep every container able to migrate under the
   lease (today's behaviour, needed for compose and non-Helm installs)?
6. **Q6 Background data steps.** May a release serve while its background data steps run (as tenant
   migrations do today), with contracts gated on them, or must every data step finish before serve?
7. **Q7 Held tenants.** Which alert threshold, and should a finite migration with tenants held past its
   floor block the next release's cleanup by name (6.8)?
8. **Q8 S0 now.** May the S0 fixes land before the redesign, in particular taking the system pass out
   of the advisory lock (it changes boot timing on every replica)?
9. **Q9 This branch's first release.** It is itself a multi-version upgrade from main's 3.20.x with
   diverged numbering (section 4, F10). Should the ledger and the S4 ordering land before that release,
   or is it shipped on today's machinery with a one-off check?

## 10. Risks

- Prisma over a subset migrations directory (6.4) is an inference; S4 must prove it before anything
  depends on it. Fallback: required stops only (refuse to skip a release with blocking steps).
- Seeding the ledger from schema position can misidentify a hand-patched database; the seed is marked
  `inferred` and `upgrade status` says so.
- Moving tenant passes off the boot changes when tenants finalize after a deploy (later, on the
  worker cadence). The legacy path stays correct meanwhile, per the runner's own contract
  (`system-migrations-runner.feature:220-226`).
- The ledger is a new store shape; it needs the table-ownership policy's agreement (Q4) before S1.
