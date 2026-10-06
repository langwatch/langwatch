# Migrations rethink: plan for Alex (2026-10-06, revision 3)

Status: design ruled by Alex on 2026-10-06 (section 9 lists his answers); three genuinely new
questions remain (section 9). No code has changed.
Ruling it answers: Q215, `.claude/coordinator/rulings-2026-10-05.md:168` ("rethink how migrations
work rather than restore the one task: version-aware, schema-aware, and no held or stuck runs. Big
work: plan it carefully first"). The question that prompted it is
`.claude/coordinator/questions-2026-10-06.md:264` (the unreachable `ObjectStorageMigrateTask`).

Revision 3 replaces revision 2's "all schema first, then data; drops wait for the floor" with
version-by-version stepping, per Alex's answer to Q1: "prisma/clickhouse migrations should know which
version they're attached to, so if you're upgrading multiple versions at once it upgrades to a version,
runs the scripts, then upgrades the next version and runs its scripts, et cetera". Section 6.5 states
what stepping needs and the cheapest design that makes it true.

Every claim cites a file and line on this branch (or a commit on `origin/main` at `2687513eaa`).
Where a claim is an inference rather than an observation it says so.

## 0. Summary

Today "migrations" are eight different mechanisms with four locks, seven entry points and no record
of which release an installation is on. Schema migrations run in order inside their own kind, nothing
orders them against data migrations, most data migrations are manual commands, and per-tenant
migrations have a `held` state with no exit.

The ruled design:

1. **One mechanism** (Q3 = B). Every step of every kind is a declared migration with one shape,
   recorded in one ledger, run by one runner through one command (`upgrade`), shown on one ops page.
   Code steps are declared by their owning module with `.withMigrations(...)`; schema SQL stays in the
   one Prisma history and the one goose directory and enters the same ledger (6.1, 6.2).
2. **Every step knows its release.** The release PR stamps each new step, SQL or code, with the
   release being cut (6.3).
3. **Version-by-version stepping** (Q1). An upgrade across several releases applies one release's
   Prisma and goose migrations, then that release's blocking steps, then the next release (6.4).
   To make that true with an image that carries only the newest code, a blocking step is frozen SQL
   pinned to its own release's schema; anything that needs live domain code is a background step that
   runs after the last release, and a later drop of its source waits for the LTS floor (6.5).
4. **Ledger in runner-owned tables** beside `_prisma_migrations` and `goose_db_version` (Q4); ops'
   page reads them through the runner.
5. **No holds.** Only the pre-roll Job and the api's first boot on a fresh install migrate (Q5, Q10);
   api and worker read the ledger and refuse by name if behind. A held tenant fails visibly, named and
   alerted, and never blocks the floor or cleanup (Q7). The floor is a named LTS release (Q2).

## 1. Goals

- **G1 Version-aware.** N upgraded to N+3 steps through N+1, N+2, N+3: each release's schema, then
  its blocking steps, then the next. Check: an integration test upgrades a database recorded at N to
  N+3 over the real migration directories and asserts the ledger order and the schema after each step.
- **G2 Schema-aware, so old ones can be cleaned up.** Each migration is attached to its release; a
  fresh install runs no historical data step; an upgrade from below the LTS floor is refused by name;
  steps and migrations below the floor can be deleted or squashed. Check: fresh-install and floor tests.
- **G3 No held or stuck runs.** No process waits without a deadline; no step is left half-applied
  without the next run knowing; a held tenant is a visible, named, alerted failure. Check: one
  scenario per sense of section 2.
- **G4 One way to do it** (Alex: "i don't want 3 ways to do things"). One step shape, one ledger, one
  runner, one command, one ops page.
- **G5 Observable.** "What release is this database on, what ran, what is outstanding, what failed and
  why" from the ops page and one CLI command.
- **G6 Keeps ADR-155**, with one gap stepping exposes (6.7, question N1).

Non-goals: replacing Prisma or goose as SQL appliers; down migrations; changing what any existing
migration does.

## 2. What "held" means, precisely

**H1 Tenant held.** A per-tenant system migration whose work ran but whose own proof disagreed:
outcome `migrated` (`packages/system-migrations/src/types.ts:41-48`, "`migrated` is the held state ...
the tenant stays on its legacy path until a later pass's proof passes"), re-counted every pass and
never progress (`types.ts:72-77`). Nothing ages it or alerts on it (`docs/self-hosting/upgrade.mdx:20-28`).
Also held: preflight work that has not drained (`specs/migration/system-migrations-runner.feature:186-210`,
`d7f39800b5`, #8249).

**H2 Boot held.** A process that cannot start because the startup migration loop does not end. Three
times on main within days: #8244 (`73d814c1b2`: the secret-heal cohort became every user, then peers'
leases read as `claimed`, 25 passes, crash loop), #8247 (`9f320b52e7`: 9,004 users, 4m43s a pass, two
passes mandatory), #8249 (`d7f39800b5`: a drain barrier waiting on a dead worker's group, every replica
crash-looping). The loop (`packages/system-migrations/src/convergence.ts:206-238`, `MAX_PASSES` `:42`,
5 s apart `:35`) still runs from `start:prepare:db` in every api and worker start
(`apps/api/package.json:19`, `apps/worker/package.json:20`).

**H3 Lock held.** `apps/tasks/src/migration-lock.ts:19-27` blocks on `pg_advisory_lock` with no
timeout. `apps/tasks/src/main.ts:59-64` holds it around the whole chain, including
`system-migrations-pass`, pinned by `apps/tasks/src/__tests__/main.unit.test.ts:71-74`, while the
task's header says it takes no lock (`apps/tasks/src/system-migrations-pass.ts:2-4`). Inference: each
extra replica waits for the first replica's whole loop. No migration session sets `lock_timeout`.

**H4 Half-run.** A failed Prisma migration blocks later deploys until `prisma migrate resolve`, and our
task says only "exited with code N" (`apps/tasks/src/prisma-migrate.ts:27`); goose on ClickHouse has no
transactions; manual backfills keep no record (3.2 K4).

Not held: **gated** tenant migrations that ship inert on self-hosted
(`runsAutomaticallyOnSelfHosted = false`,
`modules/identity/process/src/services/system-migration-identity-identifier-backfill.service.ts:25`).

## 3. Current state

### 3.1 Entry points that migrate

| Entry                  | What it runs                                                                                        | Evidence                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| api container start    | prisma-migrate, clickhouse-migrate, lwql-provision, system-migrations-pass, under one advisory lock | `apps/api/package.json:19-20`, `infra/docker/Dockerfile:299-316`                               |
| worker container start | the same chain                                                                                      | `apps/worker/package.json:19-20`, `infra/docker/Dockerfile:314-315`                            |
| Helm pre-roll Job      | `start:prepare:db` on the new image, `pre-upgrade` only, one attempt, 2100 s deadline               | `charts/langwatch/templates/app/migrate-pre-roll-job.yaml:47-75,113`                           |
| self-hosted compose    | app (image CMD) and workers (`pnpm run start`) each run the chain                                   | `infra/compose.yml:3,33-34`                                                                    |
| npx server             | prisma-migrate, then clickhouse-migrate only                                                        | `apps/server/src/services/migrate.ts:53,60`                                                    |
| dev compose            | `prisma migrate deploy` directly (no lock), then clickhouse-migrate                                 | `dev/compose.dev.yml:308-309`                                                                  |
| pnpm dev / haven       | `start:prepare:db` once before the lanes                                                            | `dev/scripts/dev-stack.sh:256`, `tools/thuishaven/app/orchestrator.go:573-575,621`             |
| CI and test fixtures   | one task alone; suites migrate ClickHouse themselves                                                | `.github/workflows/e2e-ci.yml:290`, `apps/worker/src/__tests__/worker-live.fixture.ts:7,30-33` |

### 3.2 The eight kinds

**K1 Postgres schema.** 363 Prisma folders, timestamp-keyed, `packages/prisma-client/prisma/migrations`,
applied by `prisma migrate deploy` (`apps/tasks/src/prisma-migrate.ts:18`) over the path configured at
`apps/tasks/prisma.config.ts:10-11`. 67 carry inline `UPDATE`/`INSERT`/`DELETE`.

**K2 ClickHouse schema.** 95 goose files, sequence-keyed, `packages/clickhouse-migrations/migrations`,
`goose up` (`goose.migration-runner.ts:824`); `up-to` already accepted (`:720`). goose runs only above
the recorded version (`.claude/skills/clickhouse-migration/SKILL.md:23-26`). Some leave a historical
backfill to the operator in a comment (`00034_...:26`, `00035_...:28`, `00062_...:36`, `00063_...:29`,
`00076_...:41-43`).

**K3 Convergent reconcilers, every boot.** TTL (`packages/clickhouse-migrations/src/ttl.reconciler.ts:488-532`),
LangWatchQL provisioning (`apps/tasks/src/lwql-provision.ts:22`), the access-config render. Healthy.

**K4 Installation-wide backfills.** Manual module tasks nothing runs or records: of the 30 in
`modules/*/process/src/tasks/*.task.ts`, `backfill-http-agent-credentials-to-secrets`,
`backfill-http-credentials-to-secrets`, `backfill-annotations-to-clickhouse`,
`agent-audit-log-ids-backfill`, `report-schedule-backfill`, `dataset-content-backfill`,
`virtual-key-config-backfill`, `model-provider-migrate-credentials`, `model-provider-migrate-custom-models`,
`backfill-organization-presence-setting`, `backfill-project-created`, `backfill-project-presence-setting`,
`stalled-runs-backfill`, `tiered-free-to-seat-event`. Dry-run conventions differ
(`modules/audit-log/process/src/tasks/agent-audit-log-ids.task.ts:13-14` against
`modules/gateway/process/src/tasks/virtual-key-config-backfill.task.ts:46,89`). The dataset backfill is
already schema-aware (`modules/dataset/process/src/services/dataset-migration.service.ts:38`). Most of
these call other modules or object storage (the credential backfills store project secrets; the dataset
one writes object storage), which matters for 6.5.

**K5 Per-tenant system migrations.** Ops owns the runner; subjects answer through their `*Api`
(`dev/docs/ARCHITECTURE.md:1307-1314`; `modules/authz/contract/src/authz.api.ts:247`,
`modules/automation/contract/src/automation.api.ts:111`, `modules/identity/contract/src/identity.api.ts:780-782`),
collected in `modules/ops/process/src/services/system-migration-pass.service.ts:447-453`. State in
`SystemMigrationTenantState` and `SystemMigrationEnrollment` (`packages/prisma-client/prisma/schema.prisma:6240-6273`).
Hourly re-drive (`modules/ops/process/src/eventing/ops-system-migrations.pipeline.ts:66`). Dead:
`SystemMigrationPassService.runStartup` (`:108-142`, test callers only) and the unregistered
`ClickHouseImportStoredObjectMigration` (`modules/stored-object/process/src/migrations/clickhouse-import.stored-object.migration.ts:42-52`).

**K6 Projection rebuilds.** `packages/eventing/src/replay/replayService.ts:40`, driven from
`modules/ops/process/src/services/replay.service.ts`; ADR-155 rule 6 (`adr/155...:56-60`).

**K7 Operator procedures.** The object-storage provider move
(`modules/stored-object/process/src/tasks/object-storage-migrate.task.ts:93,304-307`), registered by no
module, inventory port unimplemented (questions file `:264`).

**K8 One-time latches.** The operator seed (`modules/ops/process/src/eventing/ops-platform-operator-seed.pipeline.ts:44,62`).

### 3.3 Locks

| Lock                   | Scope                         | Wait                     | Evidence                                                   |
| ---------------------- | ----------------------------- | ------------------------ | ---------------------------------------------------------- |
| Postgres advisory lock | installation, session         | unbounded                | `apps/tasks/src/migration-lock.ts:3-27`                    |
| ClickHouse schema lock | one host (`os.tmpdir()` file) | 110 s                    | `packages/clickhouse-client/src/schema-lock.ts:27-36`      |
| Tenant leases (Redis)  | tenant per pass               | none, fails safe to held | `packages/system-migrations/src/lease.repository.ts:6-15`  |
| Drain barrier          | preflight groups              | deadline                 | `specs/migration/system-migrations-runner.feature:186-210` |

### 3.4 Records and versions today

`_prisma_migrations`, `goose_db_version` (pre-created at `goose.migration-runner.ts:583-607`),
`SystemMigrationTenantState`. Nothing records the release. Releases come from release-please
(`.github/.release-please-manifest.json`, `".": "3.20.1"`; `.github/release-please-config.json` writes it
into `apps/api/package.json:3` and `charts/langwatch/Chart.yaml:5-6`), tagged `langwatch@v*`
(`.github/workflows/publish-docker-ecr.yml:32,126-129`). Cloud runs `git-<sha>` images from every merge
to main (`publish-docker-ecr.yml:4-14`). The contract note names the release whose code stopped using a
thing (`.claude/skills/postgres-migration/SKILL.md:39-42`); no migration carries one yet.

## 4. Failure modes, seen and latent

| #   | Failure                                                                          | Seen?    | Evidence                                                                |
| --- | -------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| F1  | Boot loops on tenant migrations crash-loop the fleet                             | seen x3  | #8244, #8247, #8249                                                     |
| F2  | Two pods apply the same ClickHouse migration; one crash-loops                    | seen     | `specs/clickhouse/concurrent-boot-migrations.feature:1-6`, `0b5f84cf0c` |
| F3  | ClickHouse not up yet; every new install restarts once                           | seen     | `e494045ab0` (#8326)                                                    |
| F4  | Each replica waits for the first's whole chain                                   | inferred | `main.ts:59-64`, `main.unit.test.ts:71-74`                              |
| F5  | A multi-release jump runs a later contract before an earlier release's data move | latent   | 6.5                                                                     |
| F6  | Manual backfills never run on self-hosted, or run while old pods still write     | latent   | `upgrade-dataset-storage.mdx:118-128`                                   |
| F7  | A failed Prisma migration blocks every later boot with a generic error           | latent   | `prisma-migrate.ts:27`                                                  |
| F8  | Held tenants stay on legacy paths with no alert; legacy code never deletable     | ongoing  | `types.ts:41-48`                                                        |
| F9  | Entry points drift (npx server skips steps; dev compose skips the lock)          | ongoing  | 3.1                                                                     |
| F10 | This branch and main number migrations independently                             | ongoing  | below                                                                   |

F10: main's `20261002090000_join_request_origin` is not on this branch; three branch-only Prisma
migrations sort below it (`20261001130000_authz_user_standing`, `20261001140000_gateway_trace_export_key`,
`20261001150000_api_key_system_managed`); the branch's goose `00101` to `00104` will collide with main's
next `00101`. `tools/migrationorder/set.go:40-66` checks a PR against its base only. With stepping, a
goose version in a later release that sorts below an earlier release's last version is refused by goose,
so F10 must be resolved before the first release (Q9).

## 5. Contradictions the redesign resolves (Q8: not fixed early)

1. `specs/setup/schema-migrations-on-start.feature:68` ("the worker never migrates") against
   `apps/worker/package.json:19-20`: Q5 makes the spec right (S3).
2. `specs/migration/system-migrations-runner.feature:323` against `:326` (pass failure ends the task
   versus prevents startup): rewritten when tenant passes leave the boot (S5).
3. `specs/migration/system-migrations-runner.feature:167-169`: orphaned steps (S5).
4. `apps/tasks/src/system-migrations-pass.ts:2-4` against `main.ts:59-64` (S3).
5. `charts/langwatch/templates/NOTES.txt:184,241`: a dataset-migration Job no template defines (S3).
6. `docs/self-hosting/upgrade.mdx:284` against `upgrade-dataset-storage.mdx:15` (S7).

## 6. Design

### 6.1 One mechanism

Every step has one shape:

- **id**: stable, never reused, the ledger key. SQL steps use their file name
  (`prisma:20261002120016_user_notification_preferences`, `clickhouse:00104`); code steps the owning
  module plus a name (`dataset:content-to-object-storage`).
- **kind**: `postgres-schema`, `clickhouse-schema`, `data`, `tenant`, `procedure`.
- **release**: stamped when the release is cut (6.3).
- **mode** (Q6, each step declares it): `blocking` (runs inside `upgrade`, at its release, before the
  next release's schema), `background` (runs on the worker after the last release), `operator` (runs
  when an operator asks, with arguments).
- **run**: for SQL kinds the file, applied by Prisma or goose; for code kinds a function with a
  checkpoint and one dry-run flag.

| Today                                   | Becomes                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| K1 Prisma folders (inline DML included) | `postgres-schema`, blocking                                                                |
| K2 goose files                          | `clickhouse-schema`, blocking                                                              |
| K2 operator-comment backfills           | `data`, background                                                                         |
| K3 reconcilers                          | run by `upgrade` every time after the last release; not ledger steps                       |
| K4 manual backfills                     | `data`, background (they need live domain code, 6.5); task name kept as an operator re-run |
| K5 tenant migrations                    | `tenant`, background; `SystemMigration` is the run function                                |
| K6 rebuilds a release needs             | `data`, background                                                                         |
| K7 provider move                        | `procedure`, operator (plan, copy, finalize, verify as arguments)                          |
| K8 latches                              | `data`, background                                                                         |

One ledger (6.6), one runner, `pnpm task upgrade` for the blocking part, the worker's existing
scheduled process manager (`ops-system-migrations.pipeline.ts:66`) for background steps,
`pnpm task upgrade run <id> [args]` for operator steps, one ops page.

### 6.2 Declaration: `.withMigrations` (Q3 = B)

The owning module declares its code steps beside its tasks, built over its own repositories, as
`.withTasks(({ app, repositories, dependencies }) => [task])` does (`dev/docs/ARCHITECTURE.md:819-825`;
`packages/process/src/feature-installer.ts:1340`). The tasks container collects them from the installed
list as it collects tasks (`apps/tasks/src/module-task.ts:61`). Ops' runner and page read that list
instead of peer answers, so the three `registeredMigrations()` operations retire and the record's
"answer the migrations they own through their `*Api`" (`ARCHITECTURE.md:1307-1308`) is amended in the
same change. A step that writes its own tables raw uses the owner's `prisma.*-migration.repository.ts`
seam, already policed (`packages/architecture-enforcer/src/policies/persistence/prisma-migration-access.ts:16-18`).
A cross-module move goes through the other module's `*Api` or a fact, as any cross-module code does.

### 6.3 How a step is attached to a release

- When release-please opens the release PR, a stamp generator (run in that PR) writes
  `migrations/releases/<version>.json`: every step id declared since the previous release, in order
  (Prisma folders in name order, goose versions ascending, then code steps in installed-module order
  and declaration order). All manifests ship in the image.
- The manifest is what "attached to a version" means for SQL: release 3.21.0's Prisma migrations are
  exactly the folders its manifest names, its goose range ends at the highest version it names.
- A step in no manifest is unreleased and belongs to the next release. Cloud deploys `git-<sha>`
  images (3.4); each cloud deploy runs its unreleased steps as one virtual release, and the ledger
  records them by id, so stamping them later changes nothing that already ran.
- The **LTS floor** (Q2) is a named LTS release declared beside the manifests: the oldest release this
  image can upgrade from. Manifests below it may be deleted.

### 6.4 How an upgrade across several releases picks and orders steps

Installation recorded at 3.20.1, image 3.23.0, LTS floor 3.19.0 (illustrative):

| Release | Manifest                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.21.0  | `prisma:..._add_storage_key` (expand), `dataset:...-copy-keys` (data, blocking, frozen SQL), `dataset:content-to-object-storage` (data, background) |
| 3.22.0  | `prisma:..._add_identifier`, `clickhouse:00110`, `identity:identifier-backfill` (tenant, background)                                                |
| 3.23.0  | `prisma:..._drop_legacy_key` (contract, retired in 3.22.0)                                                                                          |

`upgrade` (pre-roll Job of 3.23.0):

1. Read the ledger: installed 3.20.1, at or above the floor (below: refuse, "upgrade to 3.19.0 LTS first").
2. Plan: releases 3.21.0, 3.22.0, 3.23.0; print the plan.
3. **3.21.0**: `prisma migrate deploy` over a directory holding only the folders of manifests up to
   3.21.0; `goose up-to` 3.21.0's last version; then 3.21.0's blocking steps (`dataset:...-copy-keys`);
   record 3.21.0.
4. **3.22.0**: the same, up to 3.22.0; no blocking steps; record.
5. **3.23.0**: the same; before the contract, check its preconditions (6.5); record.
6. Reconcilers (TTL, LangWatchQL); record the run done. api and worker, which only read the ledger,
   now start.
7. The worker runs background and tenant steps of 3.21.0 to 3.23.0 in release order.

Fresh 3.23.0 install: apply all schema at once (nothing to step through), record every data, tenant and
procedure step of every manifest `not-needed`, start. Pre-ledger installation: S1 seeds the installed
release as the newest manifest whose schema ids are all applied, marked `inferred`.

### 6.5 What stepping needs, and the cheapest way to make it true

The image carries only the newest code and the newest generated Prisma client. When 3.21.0's blocking
step runs, the schema is at 3.21.0, not 3.23.0. Four things follow.

1. **Prisma over a subset directory.** `apps/tasks/prisma.config.ts:10-11` names the migrations path;
   the runner writes a temporary directory per release (the manifest's folders plus every earlier one,
   and `migration_lock.toml`) and deploys over it. The subset only grows, so the database never holds
   an applied migration the directory lacks. Unproven: S4 must show `migrate deploy` over successive
   subsets leaves `_prisma_migrations` consistent, including F10's out-of-order timestamps. goose needs
   nothing new (`up-to`).
2. **A blocking code step cannot use the newest model client.** Prisma's generated client selects,
   returns and defaults every field it knows (an inference about Prisma's default select, `RETURNING`
   and client-side defaults; S4 confirms it), so a 3.23 client against a 3.21 table missing a 3.22
   column fails. Options weighed:
   - _Keep old code paths in the image_ (each release's services and repositories): the image would
     carry several versions of every module. Rejected: unbounded.
   - _A per-release schema snapshot_ (one generated Prisma client per release): heavy (a client per
     release in the image, regenerated for every release since the floor). Rejected.
   - **Frozen SQL (chosen, cheapest).** A blocking code step is written against its own release's
     schema in raw SQL (`$queryRaw`/`$executeRaw` through its owner's `*-migration.repository.ts`, or a
     ClickHouse query), names its columns explicitly, and is immutable once released. Most blocking data
     moves are plain SQL already (67 Prisma migrations carry inline DML); a code step is only for
     batching a large table or crossing Postgres and ClickHouse.
     Enforced by: a lint rule that a blocking step's file imports only its owner's migration repository and
     the step contract (no services, no peer `*Api`, no model client); and the immutability check the
     migration-order workflow already applies to merged migrations
     (`specs/ci/migration-order.feature:43-47`), extended to released step files.
3. **Steps that need live domain code are background.** The K4 backfills call other modules, object
   storage or event pipelines; tenant migrations emit events. They cannot be frozen SQL. They run on
   the worker after the last release, against the newest schema and code, which is what they are
   written for.
4. **A drop must not remove what a pending background step reads.** In stepping, a 3.23 contract runs
   before 3.21's background step. So the floor rule survives in exactly one case: a contract that
   retires a background or tenant step's source may ship only in a release whose LTS floor is at or
   above that step's release, so every supported installation has finished the step before it can
   reach the drop. The contract names the step it retires (`-- contract: retired in 3.22.0; retires
dataset:content-to-object-storage`), and the stamp fails the release otherwise. Contracts that
   retire nothing a background step reads (most of them) keep ADR-155's one release. A blocking step's
   source can be dropped in the very next release: stepping guarantees the step already ran.

**Held tenants at a drop** (Q7: never blocking). If a tenant step's legacy source reaches its drop while
some tenants are held, the drop proceeds and those tenants fail visibly (named, alerted, `failed` in the
ledger). Whether their legacy rows are archived first is question N2.

### 6.6 The ledger (Q4)

Runner-owned infrastructure tables beside `_prisma_migrations` and `goose_db_version`, outside the
module catalogue (names illustrative): `_langwatch_upgrade_run` (image release or sha, started,
finished, outcome, plan) and `_langwatch_upgrade_step` (id, kind, release, mode, status
`pending | running | done | not-needed | failed | gated`, attempt, last error, checkpoint report), plus
the installation's origin release and the current lease. Ops' page reads them through a reader the
runner package exports, as ops already drives `packages/eventing`'s `ReplayService`
(`modules/ops/process/src/services/replay.service.ts`). `SystemMigrationTenantState` stays ops' per-tenant
truth; the ledger holds each tenant step's summary.

### 6.7 Locking without holds (Q5, Q10)

- **Serving processes never migrate and never wait.** api and worker read the ledger at boot and refuse
  by name, listing outstanding step ids and the command, if any blocking step up to their release (or
  sha) is not `done`/`not-needed`. The one exception (Q10): on a Helm first install the api's first boot
  finds an empty ledger on an empty schema and runs `upgrade` once.
- **Only `upgrade` takes the lease**: one row (owner, image, host, heartbeat, expiry). A second runner
  logs the holder and waits up to a deadline, then exits naming it; a dead holder's lease expires; a step
  left `running` resumes from its checkpoint.
- **DDL timeouts**: migration sessions set `lock_timeout` and retry with backoff.
- **ClickHouse under the same lease**; the file lock stays for tests.
- **Background and tenant steps run on the worker**, under today's per-tenant leases; never in a boot.
- **Old pods during a multi-release jump.** ADR-155 promises the previous image works on the new schema,
  one release apart. In a jump from N to N+3 the old N pods keep serving while the pre-roll Job steps to
  N+3, and a contract retired in N+2 drops something N still uses. The runner can see it (the contract
  note names its retired-in release, above the installed one). What it should then do is question N1.

### 6.8 Tenant migrations: fail visibly, never block (Q7)

- `migrated` splits by reason: `held:proof` (the proof disagreed) and `held:pending` (queued work not
  drained).
- Every held row carries `heldSince`; past a threshold ops raises an alert naming migration and tenant,
  and the ledger shows the tenant step `failed` for that tenant. Nothing waits on it: not a boot, not the
  floor, not cleanup.
- Cloud pacing stays on the step (`enrolledAutomatically`, `runsAutomaticallyOnSelfHosted`,
  `packages/system-migrations/src/system-migration.ts:52,59`); a gated step is `gated`, not `pending`.

### 6.9 How it runs: cloud, self-hosted, local dev

| Environment                                | First install                                                                                                                                                                                     | Upgrade                                                                                                                                                                               | api and worker                                            | Background and tenant steps                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Cloud (Helm, replicas, `git-<sha>`)        | as self-hosted Helm                                                                                                                                                                               | pre-roll Job runs `upgrade` before any Deployment rolls (`migrate-pre-roll-job.yaml:62-75`); each deploy is one virtual release of its unreleased steps                               | read the ledger; refuse by name if behind                 | worker; tenant steps paced by enrolment                 |
| Self-hosted Helm                           | api's first boot runs `upgrade` once on an empty schema (Q10; a pre-install Job cannot read the release's Secrets, `migrate-pre-roll-job.yaml:29-32`); the worker refuses and restarts until done | pre-roll Job steps release by release; `app.migrations.preRoll: false` (`:43-45`) now means the operator runs `upgrade` themselves                                                    | as cloud                                                  | worker; automatic where `runsAutomaticallyOnSelfHosted` |
| Self-hosted compose                        | a one-shot `migrate` service runs `upgrade`; app and workers `depends_on` it (`service_completed_successfully`), replacing their own chains (`infra/compose.yml:3,33-34`)                         | the same service on every `up`; a ledger read when done                                                                                                                               | as cloud                                                  | worker                                                  |
| npx `@langwatch/server`                    | the CLI runs `upgrade` before the services (replacing `apps/server/src/services/migrate.ts:53,60`)                                                                                                | the same on every start                                                                                                                                                               | as cloud                                                  | worker                                                  |
| Local dev (haven, `pnpm dev`, dev compose) | the prepare step runs `upgrade` once (`orchestrator.go:573-575`, `dev-stack.sh:256`, `dev/compose.dev.yml:308-309`); a reset database is a fresh install                                          | the same; unreleased steps run as one virtual release                                                                                                                                 | lanes never migrate (`specs/setup/boot-sequence.feature`) | the worker lane                                         |
| Tests                                      | suites apply schema through the appliers (`worker-live.fixture.ts:7,30-33`): the fresh-install path                                                                                               | a step's test runs it over a fixture at its release's schema; CI upgrades a database from the previous release and from the LTS floor (ADR-155 "still to land", `adr/155...:119-122`) | n/a                                                       | n/a                                                     |

### 6.10 Observability

`pnpm task upgrade status` (origin, installed, image, floor, outstanding by release, failed tenants by
age) and `pnpm task upgrade plan` (printed first by the pre-roll Job); the ops page lists every step of
every kind with release, status and report, and the run history; metrics for step duration, failed and
held tenant counts and the oldest held age.

### 6.11 Idempotency and half-run rules

- Code steps are idempotent and checkpointed in the ledger; one dry-run flag.
- A failed Prisma migration is detected before `deploy` (a `_prisma_migrations` row with `finished_at`
  and `rolled_back_at` null) and reported with its name and the resolve command.
- ClickHouse DDL uses `IF NOT EXISTS` / `IF EXISTS` forms (a migration-safety rule beside
  `packages/clickhouse-migrations/src/__tests__/migration-safety.rules.ts`).
- Inline DML in a Prisma migration stays allowed: under stepping it is the simplest blocking data step.

## 7. Migration path

Nothing is renumbered; nothing already applied runs again; per Q8 nothing lands before the redesign,
and per Q9 S1 to S4 land before this branch's first release.

1. Ledger tables, seeded from `_prisma_migrations`, `goose_db_version` and `SystemMigrationTenantState`.
2. Manifests stamped from the release PR, and backfilled for every release since the current LTS from
   the `langwatch@v*` tags.
3. `upgrade` replaces `start:prepare:db` everywhere; api and worker read the ledger.
4. Stepping switches on (proved by S4), then tenant passes leave the boot, then `.withMigrations`, then
   backfills move over, then the floor and cleanup.

## 8. Slices

Lane-sized, each with its own scenarios, each green on its own. S1 to S4 before the first release (Q9).

- **S1 Ledger.** Runner-owned tables (Q4) and seeding; integration test against the local Postgres.
- **S2 Manifests and read side.** The stamp generator in the release PR; manifests backfilled since the
  LTS; `upgrade status` and `plan`; the reader ops' page uses.
- **S3 One entry point** (Q5, Q10). `upgrade` with the lease, deadlines and `lock_timeout`; api and
  worker read the ledger and refuse by name; the Helm first-boot path; repoint the pre-roll Job and its
  opt-out, self-hosted compose (`migrate` service), npx server, haven, `pnpm dev`, dev compose, CI.
  Resolves section 5 items 1, 4 and 5.
- **S4 Stepping.** Prisma over successive subset directories and goose `up-to` per release; prove the
  Prisma subset deploy (including out-of-order timestamps) and the default-select inference of 6.5; the
  N to N+3 integration test over the real directories; fresh-install `not-needed`; resolve F10's goose
  collision with the merge drive.
- **S5 Tenant steps off the boot** (Q7). Held reason split, `heldSince`, alert, visible failure; delete
  `runStartup` and the `startup` execution mode; rewrite the runner spec (section 5 items 2, 3).
- **S6 `.withMigrations`** (Q3). Framework declaration beside `.withTasks`; tenant migrations move to it;
  the three `registeredMigrations()` operations retire; ARCHITECTURE.md §7 amended in the same change.
- **S7 Steps.** The lint rule and immutability check for frozen blocking steps; K4 backfills become
  background steps (first `dataset-content-backfill`, resolving section 5 item 6); K2 comment backfills
  become steps; the ClickHouse idempotent-DDL scanner rule.
- **S8 Procedures.** Stored-object declares the provider move as a `procedure` step (needs the
  inventory's peer data ruled, questions file `:264`); decide `ClickHouseImportStoredObjectMigration`.
- **S9 LTS floor and contracts.** The floor and its refusal; the contract note's `retires` check in the
  stamp (6.5 point 4); the old-pod check (N1).
- **S10 Cleanup.** When a new LTS is named: delete manifests, steps and legacy paths below it; squash
  the Prisma and goose history below it into a baseline.

## 9. Questions

**Ruled by Alex, 2026-10-06:** Q1 version-by-version stepping (6.4, 6.5). Q2 the floor is a named LTS
release. Q3 (B) `.withMigrations`, one mechanism. Q4 runner-owned infrastructure tables; ops' page reads
them through the runner. Q5 only the pre-roll Job and first boot migrate; api and worker refuse by name
if behind. Q6 each step declares blocking or background. Q7 a held tenant fails visibly, named and
alerted, and blocks nothing. Q8 nothing lands before the redesign. Q9 S1 to S4 land before this branch's
first release. Q10 on a Helm first install the api's first boot migrates once.

**New, raised by stepping:**

1. **N1 Old pods during a multi-release jump.** While the pre-roll Job steps from N to N+3, the N pods
   still serve, and a contract retired in N+2 can drop something N still uses (6.7). Options: (a) when
   the plan contains such a contract, the Job scales the app and workers to 0 first and says so (the
   chart already has a Job that scales workers to 0, `charts/langwatch/templates/app/stored-objects-serialize-upgrade.yaml:20-24`),
   accepting downtime for that jump; (b) refuse such jumps and require an intermediate image; (c) accept
   errors on old pods until the rollout. The lane leans to (a).
2. **N2 Held tenants at a drop.** When cleanup or a contract removes a tenant step's legacy source while
   tenants are held, archive their legacy rows to a retained table before the drop, or accept losing them
   after the alert? The lane leans to archiving.
3. **N3 The one surviving floor rule.** Is it acceptable that a drop of a background or tenant step's
   source waits until the LTS floor passes that step (6.5 point 4), or should such data moves be forced
   into frozen blocking steps instead, at the cost of rewriting them as SQL?

## 10. Risks

- S4 may show Prisma does not tolerate successive subset deploys; then stepping needs our own applier
  writing `_prisma_migrations`-compatible rows, a larger slice.
- Frozen SQL steps are harder to write than service code; most moves will choose background, which N3
  makes slower to clean up.
- Refusing to start when behind turns a forgotten `upgrade` into new pods that will not start; old pods
  keep serving and the refusal names the command, but the chart notes must say it loudly.
- Seeding from existing records can misread a hand-patched database; the seed is marked `inferred`.
- Tenant passes off the boot finalize tenants later after a deploy; the legacy path stays correct
  meanwhile (`system-migrations-runner.feature:220-226`).
