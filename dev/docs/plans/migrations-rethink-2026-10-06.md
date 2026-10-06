# Migrations rethink: plan for Alex (2026-10-06, revision 2)

Status: proposal. No code has changed. Q5 and Q8 are answered (section 9); the rest is not ruled.
Ruling it answers: Q215, `.claude/coordinator/rulings-2026-10-05.md:168` ("rethink how migrations
work rather than restore the one task: version-aware, schema-aware, and no held or stuck runs. Big
work: plan it carefully first"). The question that prompted it is
`.claude/coordinator/questions-2026-10-06.md:264` (the unreachable `ObjectStorageMigrateTask`).

Revision 2 folds in Alex's answers of 2026-10-06: only the pre-roll Job and first boot migrate, and
api and worker read the ledger and refuse by name if behind (Q5); nothing lands before the redesign
(Q8). It answers his Q3 note ("i don't want 3 ways to do things ... how it works with version of
langwatch etc? and cloud vs self host vs local dev?") with one mechanism (6.1), the three shapes
weighed (6.2), how a step is tied to a version (6.3, 6.4) and how it runs everywhere (6.9).

Every claim cites a file and line on this branch (or a commit on `origin/main` at `2687513eaa`).
Where a claim is an inference rather than an observation it says so.

## 0. Summary

Today "migrations" are eight different mechanisms with four locks, seven entry points and no record
of which release an installation is on. Schema migrations run in order inside their own kind, but
nothing orders them against data migrations, most data migrations are manual commands an operator
has to know about, and the per-tenant migrations have a `held` state with no exit.

The proposal:

1. **One mechanism.** Every step of every kind (Postgres schema, ClickHouse schema, data and
   backfill, tenant migration, object-storage move) is a declared migration with one shape, recorded
   in one ledger, run by one runner through one command, shown on one ops page (6.1).
2. **Declared by its owner.** Code steps are declared by the module that owns the data, through one
   module declaration (`.withMigrations`, recommended over a central registry or a privileged folder,
   6.2). Schema SQL stays where the schema is (one Prisma history, one goose directory) and enters the
   same ledger.
3. **Tied to a version by the release that ships it.** A step is identified by a stable id; the
   release PR stamps every new step with the release being cut. The runner runs what the ledger has
   not seen, in release order; the release number decides only the floor (6.3, 6.4).
4. **Schema-aware by one invariant.** A contract (a drop, a type change) may only remove what data
   steps at or below the floor needed. Then all schema runs first, data steps run after it in release
   order, and nothing a pending data step reads can be gone. A fresh install runs no historical data
   step; anything older than the floor can be deleted (6.5).
5. **No holds.** Only the pre-roll Job and first boot migrate (Q5); api and worker read the ledger and
   refuse by name if behind, so no serving process ever waits on a lock or a tenant pass. Locks that
   remain have deadlines; held tenants have a reason, an age and an alert (6.7, 6.8).

## 1. Goals

From Alex's words, each made checkable:

- **G1 Version-aware.** An installation on release N upgraded straight to N+3 runs exactly the steps
  of N+1, N+2 and N+3, data steps in release order, and no contract removes something an outstanding
  step still needs. Check: an integration test that upgrades a database recorded at N to N+3 and
  asserts the ledger order.
- **G2 Schema-aware, so old ones can be cleaned up.** A fresh install runs none of the historical
  data steps; an upgrade from below the supported floor is refused by name; anything below the floor
  can be deleted from the tree without breaking a supported upgrade. Check: a fresh-install test
  records every historical data step as `not-needed`; a floor test refuses by name.
- **G3 No held or stuck runs.** No process waits without a deadline; no step can be left half-applied
  without the next run knowing; no tenant stays held without a reason, an age and an alert. Check:
  section 2's four senses each get a scenario.
- **G4 One way to do it** (Alex, 2026-10-06: "i don't want 3 ways to do things"). One step shape, one
  ledger, one runner, one command (`upgrade`), one ops page, for every kind.
- **G5 Observable.** "What release is this database on, what ran, what is outstanding, what is held
  and why" is answered from the ops page and one CLI command.
- **G6 Keeps ADR-155.** Expand/contract, no down migrations, the pre-roll gate
  (`dev/docs/adr/155-migrations-are-never-breaking.md:30-66`).

Non-goals: replacing Prisma or goose as SQL appliers; down migrations; changing what any existing
migration does.

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

Each was fixed by teaching the loop a new exception. The shape that produced them (a convergence loop
inside every replica's boot) is still there: `packages/system-migrations/src/convergence.ts:206-238`
(25 passes, `MAX_PASSES` at `:42`, 5 s apart at `:35`) runs from `start:prepare:db` on every api and
worker start (`apps/api/package.json:19`, `apps/worker/package.json:20`). Q5 removes it from serving
processes altogether.

**H3 Lock held.** A runner waiting on another runner's lock with no deadline:

- `apps/tasks/src/migration-lock.ts:19-27` tries `pg_try_advisory_lock`, then blocks on
  `pg_advisory_lock` with no timeout.
- `apps/tasks/src/main.ts:59-64` takes that lock around the WHOLE chain whenever any task in it needs
  the database, so `system-migrations-pass` (up to 25 passes) runs under it, and the test pins that
  (`apps/tasks/src/__tests__/main.unit.test.ts:71-74`, order `lock, prisma, clickhouse, lwql, system,
unlock`). The task's own header says the opposite: "No migration lock: the pass leases per tenant"
  (`apps/tasks/src/system-migrations-pass.ts:2-4`). Inference: every replica after the first waits for
  the first replica's entire convergence loop, and a no-op second pass still queues on the lock.
- No migration session sets `lock_timeout` or `statement_timeout` (no match in `apps/tasks`,
  `packages/prisma-client`, `packages/clickhouse-migrations`). Inference: a DDL that needs an
  `ACCESS EXCLUSIVE` lock behind a long query queues every later query on that table behind it. Not
  observed in an incident; a standard Postgres hazard.

**H4 Half-run.** A step that stopped part way and leaves the next run unable to tell:

- Prisma marks a failed migration failed and refuses later deploys until someone runs
  `prisma migrate resolve`; our task reports only "prisma migrate deploy exited with code N"
  (`apps/tasks/src/prisma-migrate.ts:27`). Nothing in the tree mentions `migrate resolve`.
- goose on ClickHouse has no transactions; a statement that ran before a failure is not recorded in
  `goose_db_version`, so the re-run repeats it. One statement per block (`adr/155...:49-50`) narrows
  this, it does not close it.
- Manual backfills keep no record of having run (3.2 K4).

Not "held" but often confused with it: **gated** tenant migrations that ship inert on self-hosted
until a later release flips them (`runsAutomaticallyOnSelfHosted = false`,
`modules/identity/process/src/services/system-migration-identity-identifier-backfill.service.ts:25`,
`system-migration-identity-secret-heal.service.ts:24`). A release act; the ledger models it (6.3).

## 3. Current state

### 3.1 Entry points that migrate

| Entry                  | What it runs                                                                                        | Evidence                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| api container start    | prisma-migrate, clickhouse-migrate, lwql-provision, system-migrations-pass, under one advisory lock | `apps/api/package.json:19-20`, `infra/docker/Dockerfile:299-316`                               |
| worker container start | the same chain                                                                                      | `apps/worker/package.json:19-20`, `infra/docker/Dockerfile:314-315`                            |
| Helm pre-roll Job      | `start:prepare:db` on the new image, `pre-upgrade` only, one attempt, 2100 s deadline               | `charts/langwatch/templates/app/migrate-pre-roll-job.yaml:47-75,113`                           |
| self-hosted compose    | app and workers each `pnpm run start`, so both run the chain                                        | `infra/compose.yml:3,33-34`                                                                    |
| npx server             | prisma-migrate, then clickhouse-migrate; no lwql-provision, no system pass                          | `apps/server/src/services/migrate.ts:53,60`                                                    |
| dev compose            | `prisma migrate deploy` directly (no advisory lock), then clickhouse-migrate                        | `dev/compose.dev.yml:308-309`                                                                  |
| pnpm dev / haven       | `start:prepare:db` once before the lanes                                                            | `dev/scripts/dev-stack.sh:256`, `tools/thuishaven/app/orchestrator.go:573-575,621`             |
| CI and test fixtures   | clickhouse-migrate or prisma-migrate alone; suites migrate ClickHouse themselves                    | `.github/workflows/e2e-ci.yml:290`, `apps/worker/src/__tests__/worker-live.fixture.ts:7,30-33` |

The record says migrations are tasks run before serve by the start script and the deploy pipeline
(`dev/docs/ARCHITECTURE.md:1297-1305`).

### 3.2 The eight kinds

**K1 Postgres schema.** 363 Prisma migration folders, timestamp-keyed, in
`packages/prisma-client/prisma/migrations`. Applied by `prisma migrate deploy`
(`apps/tasks/src/prisma-migrate.ts:18`). 67 of them carry inline `UPDATE`/`INSERT`/`DELETE` data steps.

**K2 ClickHouse schema.** 95 goose files, sequence-keyed, in `packages/clickhouse-migrations/migrations`,
applied with `goose up` (`packages/clickhouse-migrations/src/goose.migration-runner.ts:824`; `up-to` is
already accepted, `:720`). goose runs only above the recorded version
(`.claude/skills/clickhouse-migration/SKILL.md:23-26`). Several migrations leave a historical backfill
to the operator in a comment (`00034_add_query_pruning_indexes.sql:26`, `00035_...:28`, `00062_...:36`,
`00063_...:29`, `00076_gateway_spend_filter_indices.sql:41-43`); nothing records whether anyone did.

**K3 Convergent reconcilers, every boot.** The TTL reconciler inside clickhouse-migrate
(`packages/clickhouse-migrations/src/ttl.reconciler.ts:488-532`, metadata-only `MODIFY TTL`),
LangWatchQL provisioning (`apps/tasks/src/lwql-provision.ts:22`), the access-config render. Desired
state, not versioned. Healthy.

**K4 Installation-wide data migrations (backfills).** Manual module tasks (`pnpm task <name>`) that
nothing runs on upgrade and nothing records. Of the 30 module tasks
(`modules/*/process/src/tasks/*.task.ts`), these move or derive data:
`backfill-http-agent-credentials-to-secrets`, `backfill-http-credentials-to-secrets`,
`backfill-annotations-to-clickhouse`, `agent-audit-log-ids-backfill`, `report-schedule-backfill`,
`dataset-content-backfill`, `virtual-key-config-backfill`, `model-provider-migrate-credentials`,
`model-provider-migrate-custom-models`, `backfill-organization-presence-setting`,
`backfill-project-created`, `backfill-project-presence-setting`, `stalled-runs-backfill`,
`tiered-free-to-seat-event`. Conventions differ: `--dry-run` opts out of writing
(`modules/audit-log/process/src/tasks/agent-audit-log-ids.task.ts:13-14`), gateway's defaults to a dry
run (`modules/gateway/process/src/tasks/virtual-key-config-backfill.task.ts:46,89`), others have none.
One is already schema-aware: the dataset backfill returns `schema-pending` and skips when its columns
are missing (`modules/dataset/process/src/services/dataset-migration.service.ts:38`,
`.../repositories/prisma/prisma.dataset-migration.repository.ts:147`). The upgrade guide calls the
dataset move automatic (`docs/self-hosting/upgrade.mdx:284`); its own page says the operator must run
it (`docs/self-hosting/upgrade-dataset-storage.mdx:15,118-128`).

**K5 Per-tenant system migrations.** `packages/system-migrations`; ops owns the runner, the subjects
own the migrations and answer them through their `*Api` (`dev/docs/ARCHITECTURE.md:1307-1314`) with
`registeredMigrations()` (`modules/authz/contract/src/authz.api.ts:247`,
`modules/automation/contract/src/automation.api.ts:111`, `modules/identity/contract/src/identity.api.ts:780-782`).
Registered in main's order (`modules/ops/process/src/services/system-migration-pass.service.ts:447-453`):
authz grant import, identity SSO connection grandfather and SSO domain ownership
(`modules/identity/process/src/app/identity.app.ts:1077-1085`), automation Slack connections;
user-rooted: identifier backfill and secret heal (`identity.app.ts:1070-1075`). State tables
`SystemMigrationTenantState`, `SystemMigrationEnrollment` (`packages/prisma-client/prisma/schema.prisma:6240-6273`).
Re-drive: an hourly scheduled process manager (`modules/ops/process/src/eventing/ops-system-migrations.pipeline.ts:66`).
Dead paths: `SystemMigrationPassService.runStartup` (`system-migration-pass.service.ts:108-142`) has
only test callers, so `executionMode: "startup"` (`packages/system-migrations/src/system-migration.ts:11`)
does nothing; `ClickHouseImportStoredObjectMigration`
(`modules/stored-object/process/src/migrations/clickhouse-import.stored-object.migration.ts:42-52`) is
registered by no module and does not exist on main. Stored-object has no `registeredMigrations()`
operation, so under today's shape it could not register one without a new `*Api` operation.

**K6 Projection rebuilds.** `ReplayService` (`packages/eventing/src/replay/replayService.ts:40`), driven
from ops (`modules/ops/process/src/services/replay.service.ts`); ADR-155 rule 6 makes a projection change
a rebuild beside the old one (`adr/155...:56-60`). Operator-triggered.

**K7 Operator procedures.** The object-storage provider migration, phases plan, copy, finalize, verify
(`modules/stored-object/process/src/tasks/object-storage-migrate.task.ts:93,304-307`), registered by no
module (`stored-object.module.ts` has no `.withTasks`); its inventory port has no implementation
(questions file `:264`). It runs on an operator's schedule with traffic paused (main's header,
`platform/app/src/tasks/migrateObjectStorage.ts:1-14` on `origin/main`).

**K8 One-time latches as process managers.** The operator bootstrap seed runs once behind a marker
(`dev/docs/ARCHITECTURE.md:1462-1476`; `modules/ops/process/src/eventing/ops-platform-operator-seed.pipeline.ts:44,62`).

### 3.3 Locks

| Lock                                          | Scope                             | Wait                        | Evidence                                                   |
| --------------------------------------------- | --------------------------------- | --------------------------- | ---------------------------------------------------------- |
| Postgres advisory lock `langwatch:migrations` | installation, session-scoped      | unbounded                   | `apps/tasks/src/migration-lock.ts:3-27`                    |
| ClickHouse schema lock                        | one host: a file in `os.tmpdir()` | 110 s, sized for test files | `packages/clickhouse-client/src/schema-lock.ts:27-36`      |
| Tenant leases (Redis)                         | per tenant per pass               | none, fails safe to "held"  | `packages/system-migrations/src/lease.repository.ts:6-15`  |
| Drain barrier                                 | preflight queue groups            | deadline, then gives up     | `specs/migration/system-migrations-runner.feature:186-210` |

Across pods, ClickHouse migrations are serialised only because they run inside the Postgres advisory
lock (`0b5f84cf0c`, #8313). The file lock does nothing between two pods.

### 3.4 What records exist, and what a version is today

`_prisma_migrations`, `goose_db_version` (pre-created at `goose.migration-runner.ts:583-607`),
`SystemMigrationTenantState`. Nothing records the release. The release number comes from release-please
(`.github/.release-please-manifest.json`, `".": "3.20.1"`; `.github/release-please-config.json` writes
it into `apps/api/package.json:3` and `charts/langwatch/Chart.yaml:5-6`), and releases are tagged
`langwatch@v*` (`.github/workflows/publish-docker-ecr.yml:32,126-129`). Cloud does not run releases:
the SaaS deployment pins a `git-<sha>` image published on every merge to main
(`publish-docker-ecr.yml:4-14`). So a release number cannot be cloud's migration key. ADR-155's contract
note names a release (`-- contract: retired in 1.42.0`, `adr/155...:61-66`); no migration carries one yet.

## 4. Failure modes, seen and latent

| #   | Failure                                                                                        | Seen?                                       | Evidence                                                                |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| F1  | Boot loops on tenant migrations crash-loop the fleet                                           | seen x3                                     | #8244, #8247, #8249 (section 2, H2)                                     |
| F2  | Two pods apply the same ClickHouse migration; one crash-loops on TABLE_ALREADY_EXISTS          | seen                                        | `specs/clickhouse/concurrent-boot-migrations.feature:1-6`, `0b5f84cf0c` |
| F3  | ClickHouse not up yet; bootstrap dies on ECONNREFUSED; every new install restarts once         | seen                                        | `e494045ab0` (#8326)                                                    |
| F4  | Every replica after the first waits for the first's whole chain, including the system pass     | inferred                                    | `main.ts:59-64`, `main.unit.test.ts:71-74`                              |
| F5  | A skipped-version upgrade runs a later contract before an earlier release's data move          | latent; the first contract step will hit it | 6.5; no contract note in tree yet                                       |
| F6  | Manual backfills never run on self-hosted, or run while old pods still write                   | latent, an operator burden                  | `upgrade-dataset-storage.mdx:118-128`                                   |
| F7  | A failed Prisma migration blocks every later boot until a manual resolve, with a generic error | latent                                      | `prisma-migrate.ts:27`                                                  |
| F8  | Held tenants stay on legacy paths indefinitely with no alert; legacy code can never be deleted | ongoing                                     | `types.ts:41-48`, `upgrade.mdx:20-28`                                   |
| F9  | Entry points drift: npx server skips lwql and the system pass; dev compose bypasses the lock   | ongoing                                     | 3.1                                                                     |
| F10 | A long-running branch and main number migrations independently                                 | ongoing                                     | below                                                                   |

F10: main's newest Prisma migration `20261002090000_join_request_origin` is not on this branch yet,
and three branch-only migrations sort below it (`20261001130000_authz_user_standing`,
`20261001140000_gateway_trace_export_key`, `20261001150000_api_key_system_managed`). ClickHouse: the
branch adds `00101` to `00104` above main's `00100`; the next main ClickHouse migration will collide on
`00101`. `tools/migrationorder/set.go:40-66` checks a PR against its base branch, so it cannot see this.

## 5. Contradictions the redesign resolves (Q8: not fixed early)

1. `specs/setup/schema-migrations-on-start.feature:68` ("the worker never migrates") against
   `apps/worker/package.json:19-20`. Q5 makes the spec right: S3 rewrites the start scripts.
2. `specs/migration/system-migrations-runner.feature:323` ("a pass that fails outright ends the task
   without failing the boot chain") against `:326` ("A failed pass prevents startup"). Tenant passes
   leave the boot chain in S5, so both scenarios are rewritten there.
3. `specs/migration/system-migrations-runner.feature:167-169`: steps orphaned after a comment block.
4. `apps/tasks/src/system-migrations-pass.ts:2-4` ("No migration lock") against `main.ts:59-64`.
5. `charts/langwatch/templates/NOTES.txt:184,241` describe a dataset-migration Job no template defines.
6. `docs/self-hosting/upgrade.mdx:284` ("automatic") against `upgrade-dataset-storage.mdx:15` (manual).

## 6. Target design

### 6.1 One mechanism

One shape for every step, whatever its kind:

- **id**: stable and unique, never reused; the ledger key. For SQL kinds the id is the file's own name
  (`prisma:20261002120016_user_notification_preferences`, `clickhouse:00104`); for code steps, the
  owner module plus a name (`dataset:content-to-object-storage`).
- **kind**: `postgres-schema`, `clickhouse-schema`, `data`, `tenant`, `procedure`.
- **release**: stamped when a release is cut (6.3); absent means unreleased.
- **mode**: `blocking` (runs inside `upgrade`, before any process may serve), `background` (runs on the
  worker after serve), `operator` (runs only when an operator asks, with arguments).
- **requires**: ids that must be `done` first (rare; release order covers most).
- **run**: for SQL kinds, the file, applied by Prisma or goose as today; for code kinds, a function
  over the owning module's repositories with a checkpoint and a dry run.

| Today                                                     | Becomes                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| K1 Prisma folders                                         | `postgres-schema`, `blocking`, applied by `prisma migrate deploy`                     |
| K2 goose files                                            | `clickhouse-schema`, `blocking`, applied by `goose up`                                |
| K2 operator-comment backfills (`MATERIALIZE INDEX` notes) | `data`, `background`                                                                  |
| K3 reconcilers (TTL, LangWatchQL)                         | stay convergent, run by `upgrade` every time, not ledger steps                        |
| K4 manual backfills                                       | `data`, `blocking` or `background` by size; the task name stays as an operator re-run |
| K5 tenant migrations                                      | `tenant`, `background`; the `SystemMigration` interface is the run function           |
| K6 projection rebuilds a release needs                    | `data`, `background`                                                                  |
| K7 object-storage provider move                           | `procedure`, `operator` (plan, copy, finalize, verify as arguments)                   |
| K8 one-time latches                                       | `data`, `background`                                                                  |

One ledger records every step (6.4). One runner applies them: `pnpm task upgrade` for the blocking
part, the worker's existing scheduled process manager (`ops-system-migrations.pipeline.ts:66`) for the
background part, `pnpm task upgrade run <id> [args]` for operator steps. One ops page lists them all.

### 6.2 Where a step is declared: the three shapes Alex named

A step's run function has to live somewhere. The three candidates:

**(A) Central registry (today's `SystemMigration` shape).** Each owning module exposes its steps
through its `*Api` (`registeredMigrations()`), and ops collects them
(`system-migration-pass.service.ts:447-453`).
Keeps: one list in one place; ops' page and runner exist and work.
Loses: every owning module needs a new `*Api` operation, a contract change, to take part (stored-object
has none, 3.2 K5); ops gains a peer edge to every owner (today authz, identity, automation), and peer
cycles must be cut, not added (`dev/docs/ARCHITECTURE.md:885-893`); an `*Api` returning runtime objects
leaks runner machinery into contracts; schema SQL cannot be answered through an `*Api`, so the SQL kinds
stay a second way.

**(B) Per-module `.withMigrations(...)` (recommended).** The owning module declares its steps beside
its tasks, built over its own repositories, exactly like `.withTasks(({ app, repositories, dependencies })
=> [task])` (`dev/docs/ARCHITECTURE.md:819-825`; `packages/process/src/feature-installer.ts:1340`). The
tasks container collects them from the installed list as it already collects tasks
(`apps/tasks/src/module-task.ts:61`, `app.tasks(isTask)`), and the runner reads that list.
Keeps: the domain together (a step sits beside the repositories it uses, the module owns every query
against its tables, CLAUDE.md rule 2); no `*Api` operation; no peer edge from ops; stored-object can
declare its procedure with no contract change. A step that must write its own tables raw uses the
existing `prisma.*-migration.repository.ts` seam, which the `prisma-migration-access` policy already
polices (`packages/architecture-enforcer/src/policies/persistence/prisma-migration-access.ts:16-18`),
so "break the rule and reach Prisma directly" is available, scoped to the owner's own tables.
Loses: a step that reads one module's data and writes another's has to go through the other's `*Api`
or a fact, as any cross-module code does (the stored-object inventory needs project and organization
data: that is still the peer-edge question `:264` asks); the runner needs the tasks container booted,
so code steps run after schema (which 6.5 wants anyway). Schema SQL is not per module, because
`schema.prisma` and the goose directory are one each; it enters the same ledger with the same id, kind
and release, so it is one mechanism with two places a step's body can live, not two mechanisms.

**(C) One privileged migrations place.** A single folder (say `apps/tasks/src/migrations/`) allowed to
import any module's repositories or use Prisma and ClickHouse directly, as apps/tasks already may for
seeding (`dev/docs/ARCHITECTURE.md:823-825`) and for the migration runners (`:1301-1303`).
Keeps: one place for every step, cross-module moves are easy, schema and data side by side.
Loses: table ownership (a step writes a module's table without its services, rules or events; for an
event-sourced projection that is wrong data, not a style point); the domain splits from its migration,
so a module refactor breaks a step nobody in the module sees; the folder grows into a second backend
that every module's internals leak into; the record and lint have to carve a standing exception.

**Recommendation: (B).** It is the only shape where adding a step needs neither a contract change nor an
exception to ownership, it reuses a declaration the framework already has, and it lets (A)'s ops runner
and page stay as they are, reading the declared list instead of peer answers. (A)'s strength (one list)
survives as the ledger and the ops page; (C)'s strength (direct access) survives as the owner's
migration repository. Under (B) the record's sentence "each subject answers the migrations they own
through their `*Api`" (`:1307-1308`) changes, and the three `registeredMigrations()` operations retire.

### 6.3 How a step is tied to a LangWatch version

- **Identity, not version, decides what runs.** The runner runs every declared step whose id the
  ledger has not recorded, in order. That works the same for cloud, which runs `git-<sha>` images and
  not releases (3.4), for self-hosted releases, and for a developer's unreleased steps.
- **The release decides order and the floor.** When release-please opens the release PR, a stamp step
  (a generator, run in that PR) writes `migrations/releases/<version>.json`: the ids of every step
  declared since the previous release, in their declared order (SQL ids in Prisma and goose order,
  code ids in installed-module order then declaration order). Every manifest ships in the image. A step
  not yet in any manifest is "unreleased" and sorts after every release.
- **Order**: by release, then within a release by kind (`postgres-schema`, `clickhouse-schema`,
  `data`, `tenant`), then by position in the manifest. Code never names a version; reviewers never
  guess a number.
- **The floor** is the oldest release this image can upgrade from, declared once beside the
  manifests. It is what lets old steps be deleted (6.5).
- **The ledger** records, per step: id, kind, release, status (`pending | running | done | not-needed
| failed`), started, finished, attempt, last error, report (checkpoint); and per run: image release
  or sha, started, finished, outcome. It also records the installation's **origin**: the release the
  database was created at (or `pre-ledger`).

### 6.4 How an upgrade across several versions picks and orders steps

Installation recorded at 3.20.1, image 3.23.0, floor 3.19.0:

| Release | Steps in its manifest                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| 3.21.0  | `prisma:...add_dataset_storage_key` (expand), `dataset:content-to-object-storage` (data, blocking) |
| 3.22.0  | `prisma:...add_identifier` (expand), `identity:identifier-backfill` (tenant, background)           |
| 3.23.0  | `clickhouse:00110` (expand), `prisma:...drop_legacy_x` (contract retiring a 3.18 data step)        |

`upgrade` on the 3.23.0 pre-roll Job:

1. Read the ledger. Installed 3.20.1 is at or above the floor 3.19.0, so proceed (below: refuse,
   "upgrade to 3.19.0 first").
2. Check every contract in the jump: `drop_legacy_x` retires a 3.18 data step, at or below the floor,
   and the ledger shows that step `done` or `not-needed`. Otherwise refuse by name before touching the
   schema (6.5).
3. Apply all schema: `prisma migrate deploy`, then `goose up`, exactly as today. Safe in one go because
   of the invariant in 6.5.
4. Run blocking data steps of 3.21.0, 3.22.0, 3.23.0 in release order: here
   `dataset:content-to-object-storage`.
5. Run the reconcilers (TTL, LangWatchQL).
6. Record 3.23.0 done. api and worker, which only read the ledger, now start.
7. The worker runs background and tenant steps in release order: `identity:identifier-backfill`.

A fresh 3.23.0 install records every data, tenant and procedure step of every manifest as
`not-needed` (there is no legacy data to move), applies the schema, and starts.

### 6.5 Schema awareness, the floor and cleanup

**Why not apply schema release by release.** Revision 1 proposed stopping Prisma at each release
boundary. It does not work cleanly: the image carries only the newest code, so a 3.21 data step would
run 3.23 code, whose generated Prisma client selects every column it knows, against a 3.21 schema that
lacks 3.22's columns (an inference about Prisma's default select; S4 confirms it). Data steps would
have to be written against old schemas forever.

**The invariant instead.** A contract (drop, type change, `NOT NULL` without a default) may only
remove what is needed by data or tenant steps at or below the floor. The manifest check in CI enforces
it: a contract names, in its ADR-155 note, the step or release it retires, and the stamp fails a
release whose contract names something above the floor. With that:

- every expand is additive and safe to run before any data step (ADR-155 rule 1);
- no contract in a supported jump can remove anything a pending step reads, because every such step is
  above the floor and every retired thing is at or below it;
- so all schema can run first, with today's tools, and every data step runs against the newest schema
  with the newest code. Each step is "schema-aware" by construction rather than by checking.

The price: a drop waits until the floor passes the data step that needed it, not one release. With a
floor of "the previous minor" that is roughly ADR-155's one release; a wider floor makes drops wait
longer (question Q2).

**Fresh installs** run no historical data or tenant step: the ledger records them `not-needed` (6.4).
Today's dataset `schema-pending` check (`dataset-migration.service.ts:38`) becomes unnecessary.

**Cleanup.** Once the floor passes a step's release, every supported installation has it `done` or
`not-needed`. Then the step's code and the legacy path it served can be deleted, and the Prisma and
goose history below the floor can be squashed into a baseline (Prisma's documented baselining; goose
likewise). The upgrade refuses an installation below the floor by name, so no deleted step is ever
needed. A tenant migration with tenants still held blocks the floor from passing its release, by name
(6.8), so legacy code is never deleted under a held tenant.

### 6.6 Idempotency and half-run rules

- Every code step is idempotent and checkpointed in its ledger `report`, and resumes from it; one
  dry-run flag with one meaning for every step.
- No new DML inside a schema migration: a migration-safety rule beside the existing scanners
  (`packages/prisma-client/src/__tests__/migration-safety.rules.ts`,
  `packages/clickhouse-migrations/src/__tests__/migration-safety.rules.ts`). Historical ones stay baselined.
- ClickHouse DDL uses `IF NOT EXISTS` / `IF EXISTS` forms so a repeat after a half-run is a no-op.
- A failed Prisma migration is detected before `deploy` (a `_prisma_migrations` row with `finished_at`
  and `rolled_back_at` null) and reported with its name and the exact resolve command.
- A step marked `running` whose runner died is visible in the ledger with its holder and age; the next
  `upgrade` resumes it from its checkpoint after the lease expires.

### 6.7 Locking without holds (with Q5)

- **Serving processes never migrate and never wait.** api and worker read the ledger at boot. If the
  image's steps up to its own release (or sha) are not all `done`/`not-needed` for the blocking ones,
  they refuse to start with a refusal naming the outstanding step ids and the command that runs them.
  No lock, no pass, no convergence loop: H2 and H3 cannot happen in a serving process.
- **Only `upgrade` takes the lease**: one installation lease row (owner, image, host, heartbeat,
  expiry). A second `upgrade` (a retried Job) logs the holder and waits up to a deadline, then exits
  naming it. A dead holder's lease expires. The advisory lock can stay underneath for mutual exclusion;
  nobody waits on it without a deadline.
- **DDL timeouts.** Migration sessions set `lock_timeout` and retry with backoff.
- **ClickHouse under the same lease**; the file lock stays for tests only.
- **Tenant and background steps run on the worker**, already serving, under today's per-tenant leases;
  they never gate a boot. A contract that needs one finalized waits for it through the floor (6.5).

### 6.8 Tenant migrations: no silent holds

- The held state splits by reason: `held:proof` (the proof disagreed; needs a repair or a decision) and
  `held:pending` (work queued, not drained; resolves itself). Today both are `migrated` (`types.ts:41-48`).
- Every held row carries `heldSince`; ops alerts past a threshold; the page sorts by age.
- A tenant step is either finite (it finalizes every tenant) or `recurring` (`startupSettlement`,
  `system-migration.ts:13`), and a recurring one never gates a contract.
- Cloud pacing stays a property of the tenant step: `enrolledAutomatically = false` keeps it to
  enrolled organizations on cloud, `runsAutomaticallyOnSelfHosted = false` keeps it inert on
  self-hosted (`system-migration.ts:52,59`). Flipping either is a change to the declaration, and the
  ledger shows the step as `gated` rather than `pending`, so a gate is never mistaken for a hold.

### 6.9 How it runs: cloud, self-hosted, local dev

`upgrade` is one command everywhere. What differs is who calls it.

| Environment                                     | First install                                                                                                                                                                                                                                                        | Upgrade                                                                                                                                                                                              | api and worker                                            | Background and tenant steps                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Cloud (Helm, many replicas, `git-<sha>` images) | not expected; same as self-hosted Helm                                                                                                                                                                                                                               | pre-roll Job runs `upgrade` on the new image before any Deployment rolls (`migrate-pre-roll-job.yaml:62-75`); every merge to main is a deploy, so the ledger keys on ids, not releases (6.3)         | read the ledger; refuse by name if behind                 | worker; tenant steps paced by enrolment (`enrolledAutomatically`)           |
| Self-hosted Helm                                | Helm cannot run a pre-install Job that reads the release's Secrets (`migrate-pre-roll-job.yaml:29-32`), so the first boot of the api finds an empty ledger and runs `upgrade` itself under the lease; the worker refuses until it is done and Kubernetes restarts it | pre-roll Job, as cloud. `app.migrations.preRoll: false` (`:43-45`) now means "the operator runs `upgrade` as a pipeline step"; api refuses until they do                                             | as cloud                                                  | worker; tenant steps run automatically when `runsAutomaticallyOnSelfHosted` |
| Self-hosted docker compose                      | a one-shot `migrate` service runs `upgrade`; app and workers `depends_on` it with `service_completed_successfully` (today both start with `pnpm run start`, `infra/compose.yml:33-34`)                                                                               | the same service on every `docker compose up`; a no-op read when done                                                                                                                                | as cloud                                                  | worker                                                                      |
| npx `@langwatch/server`                         | the CLI runs `upgrade` before starting the services (replacing its two task calls, `apps/server/src/services/migrate.ts:53,60`)                                                                                                                                      | the same, on every start                                                                                                                                                                             | as cloud                                                  | worker                                                                      |
| Local dev: haven, `pnpm dev`, dev compose       | the prepare step runs `upgrade` once (`orchestrator.go:573-575`, `dev-stack.sh:256`, `dev/compose.dev.yml:308-309`); a reset database is a fresh install                                                                                                             | the same; unreleased steps run because their ids are new                                                                                                                                             | lanes never migrate (`specs/setup/boot-sequence.feature`) | the worker lane                                                             |
| Tests                                           | integration suites keep applying schema directly through the appliers (`worker-live.fixture.ts:7,30-33`): the fresh-install path, no data steps                                                                                                                      | a data step's own test runs it over a seeded legacy fixture; a CI job upgrades a database migrated by the previous release, and one from the floor (ADR-155's "still to land", `adr/155...:119-122`) | n/a                                                       | n/a                                                                         |

First install versus upgrade is the ledger's answer, not the caller's: an empty ledger on an empty
schema is a first install; an empty ledger on an existing schema is a pre-ledger installation, seeded
once (6.10, slice S1).

### 6.10 Observability

- `pnpm task upgrade status`: origin, installed release or sha, image, floor, outstanding steps by
  release, held tenants by age.
- `pnpm task upgrade plan`: what `upgrade` would run; the pre-roll Job prints it first, so a failed
  Job's log starts with the plan.
- The ops migrations page (`docs/self-hosting/upgrade.mdx:43-48`) lists every step of every kind with
  its release, status and report, and the run history.
- Metrics: step duration, oldest held tenant age, held, parked and gated counts.

### 6.11 Open design points that remain

Ledger table ownership (Q4) and the stored-object inventory's peer data (`questions-2026-10-06.md:264`)
are not decided by this plan.

## 7. Migration path

Nothing is renumbered; nothing already applied runs again. Per Q8, nothing lands before the redesign;
the contradictions of section 5 are fixed inside the slice that changes their behaviour.

1. Ledger tables land and are seeded from today's records: `_prisma_migrations` and `goose_db_version`
   rows become `done` steps; `SystemMigrationTenantState` summaries become tenant step rows; the
   installed release is the newest manifest whose schema ids are all applied, marked `inferred`.
2. `upgrade status` and `plan` read it; the stamp generator writes the first manifests (backfilled for
   releases since the floor from git tags `langwatch@v*`).
3. `upgrade` replaces `start:prepare:db` in every entry point at once (6.9); api and worker switch to
   reading the ledger.
4. Tenant passes leave the boot entirely; the worker's process manager drives them.
5. `.withMigrations` lands; manual backfills move over one owner at a time.
6. The contract invariant is enforced; the floor is declared; cleanup and squash follow.

## 8. Phased slices

Each slice is lane-sized, has its own scenarios and lands green on its own. The former S0 items are
folded in where their behaviour changes (Q8).

- **S1 Ledger.** Tables (after Q4), seeding from existing records; integration test against the local
  Postgres. Fixes nothing yet, changes nothing.
- **S2 Read side.** `upgrade status` and `plan`; the stamp generator and the first manifests; CI that
  the stamp is in the release PR.
- **S3 One entry point (Q5).** `upgrade` with the lease, bounded waits and `lock_timeout`; api and
  worker read the ledger and refuse by name; first-boot path; repoint Helm Job, chart opt-out, self-hosted
  compose (new `migrate` service), npx server, haven, `pnpm dev`, dev compose, CI. Rewrites
  `specs/setup/schema-migrations-on-start.feature` and `boot-sequence.feature` (section 5 items 1, 4),
  removes the system pass from the advisory lock (`main.ts:38,59-64`, `main.unit.test.ts:73`), fixes
  the chart NOTES (item 5).
- **S4 Ordering.** All schema, then blocking data in release order; the N to N+3 integration test; the
  fresh-install `not-needed` path; confirm the Prisma default-select inference of 6.5.
- **S5 Tenant steps.** Off the boot; held reason split, `heldSince`, ops alert; rewrite the runner spec
  (section 5 items 2, 3); delete `runStartup` and the `startup` execution mode.
- **S6 `.withMigrations` (after Q3).** Framework declaration beside `.withTasks`; the runner reads the
  installed list; tenant migrations move from `registeredMigrations()` to it and the three `*Api`
  operations retire; ARCHITECTURE.md §7 amended in the same change.
- **S7 Backfills.** The K4 tasks become declared steps (first `dataset-content-backfill`, which fixes
  section 5 item 6, then one small one such as `backfill-project-created`, then the rest); the K2
  operator-comment backfills become steps; scanner rules for DML in schema migrations and idempotent
  ClickHouse DDL.
- **S8 Procedures.** Stored-object declares the provider move as a `procedure` step (answers Q215's
  original question once the inventory's peer data is ruled); decide the unregistered
  `ClickHouseImportStoredObjectMigration`.
- **S9 Floor.** The contract invariant in CI, the floor, refusal below it.
- **S10 Cleanup.** Squash below the floor; delete steps and legacy paths the floor has passed.

## 9. Questions for Alex

**Q3 (open, asked again with options).** How does a module declare a migration step?

- **(A) Central registry**: keep `SystemMigration` and `registeredMigrations()` on each owner's `*Api`;
  ops collects. One list, but a contract operation per owning module, an ops peer edge to every owner,
  and schema SQL still separate.
- **(B) Per-module `.withMigrations(...)`** (recommended): the owner declares steps beside `.withTasks`,
  over its own repositories (raw Prisma allowed through its own `*-migration.repository.ts`); the tasks
  container collects them; ops' runner and page read that list. No contract change, no ops peer edges,
  domain kept together; a cross-module move still goes through the other module's `*Api`.
- **(C) One privileged migrations folder** allowed to reach any module's repositories or Prisma: one
  place and easy cross-module moves, at the cost of table ownership and event-sourced invariants, a
  standing exception in the record and lint, and migrations that drift from the domain they change.

In all three the ledger, the runner, the `upgrade` command, the ordering and the ops page are the same
single mechanism (6.1); the choice is only where a step's body lives.

**Answered 2026-10-06.** Q5: only the pre-roll Job and first boot migrate; api and worker read the
ledger and refuse by name if behind (6.7, 6.9). Q8: nothing lands before the redesign; the S0 fixes
are folded into S3 and S5 (section 8).

Still open:

1. **Q1 Interpretation.** Is "schema aware, run only up to where needed, so we can clean up" what 6.5
   describes (fresh installs skip history; contracts wait for the floor; a floor that lets old steps
   and old migrations be deleted)? Or something narrower, such as only squashing?
2. **Q2 Floor policy.** How far back must a self-hosted install upgrade in one go: the previous minor,
   a fixed number of minors, or a named long-term release? A wider floor makes drops wait longer (6.5).
3. **Q4 Ledger ownership.** Infrastructure tables beside `_prisma_migrations` and `goose_db_version`,
   owned by the runner and outside the catalogue, or ops' tables (ops owns `SystemMigration*` today)?
4. **Q6 Blocking or background.** May a release serve while its background data steps run (as tenant
   migrations do today), or must every data step finish before serve? The plan lets each step choose.
5. **Q7 Held tenants.** Which alert threshold, and should held tenants of a finite migration block the
   floor from passing its release (6.8)?
6. **Q9 This branch's first release.** It is a multi-version upgrade from main's 3.20.x with diverged
   numbering (F10). Ship it on the ledger (S1 to S4 first) or on today's machinery with a one-off check?
7. **Q10 First install on Helm.** The api's first boot migrating (6.9) keeps one serving process
   migrating once. Acceptable, or should the chart create its Secrets as earlier-weight hooks so a
   pre-install Job can migrate instead?

## 10. Risks

- The Prisma default-select claim behind 6.5 is an inference; S4 confirms it. If it is wrong the
  invariant is still the simpler design.
- The contract invariant makes drops wait for the floor; with a wide floor, dead columns linger.
- Seeding the ledger from existing records can misread a hand-patched database; the seed is marked
  `inferred` and `upgrade status` says so.
- Refusing to start when behind (Q5) turns a forgotten `upgrade` into an outage of new pods; the old
  pods keep serving, and the refusal names the command, but it must be loud in the chart notes.
- Moving tenant passes off the boot finalizes tenants later after a deploy; the legacy path stays
  correct meanwhile (`system-migrations-runner.feature:220-226`).
