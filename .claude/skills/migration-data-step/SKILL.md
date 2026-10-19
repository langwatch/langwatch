---
name: migration-data-step
description: "Write a data or tenant step with defineMigrationStep and .withMigrations: the id `<module>:<kebab-name>`, kind, mode (blocking frozen SQL, background on the worker), the required one-line description, needsOldWritersGone, after, finishBy, queueWaitMs, and the run function with its checkpoint `{ resumeFrom, save({ report }) }`, dry-run flag and abort signal. Covers the properties every step has (idempotent and checkpointed, level-triggered, copy never move, one pass per table), pacing by the step's own queue work, tenant steps (migrateTenant, the proof, framework-owned per-tenant state, held, parked and rolled-back tenants), operator-started tasks (storage moves, resealing), projection replay steps (defineProjectionReplayStep, the binder's replayer), where the step's SQL may live, and how to test one. Use when someone says 'backfill', 'data migration', 'migrate the data', 'move rows', 'copy to the new column', 'fill the new column', 'migrate to object storage', 'tenant migration', 'system migration', 'held tenant', 'blocking step', 'background step', 'withMigrations', 'defineMigrationStep', 'checkpoint', 'resumeFrom', 'frozen SQL', 'level-triggered', 'idempotent backfill', 'dry run', 'archive-or-fail', 'defineProjectionReplayStep', 'fill a new projection at deploy', or a one-shot backfill task needs converting."
user-invocable: true
argument-hint: "<what data moves, from where to where, and whether the next schema needs it done first>"
---

# Write a data step

A data step moves or reshapes data between an expand and its contract. Schema is the
`postgres-migration` and `clickhouse-migration` skills; which recipe applies at all is `migration`.
Record: ARCHITECTURE.md §7 (the rulings of rounds 14 to 16 are in ADR-173) and §9 for the events a
step records; design `dev/docs/plans/migrations-rethink-2026-10-06.md`, cited "plan 6.x".

## 1. Choose kind and mode

| The step                                                                                                                                                 | Kind     | Mode         | Runs                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ | ---------------------------------------------------------- |
| Rows of a table the same migration creates, SQL only                                                                                                     | none     | none         | inline SQL in that Prisma migration (`postgres-migration`) |
| Needs domain code, a peer `*Api`, object storage, events or a model                                                                                      | `data`   | `background` | on the worker after the last release, newest code          |
| A later release's schema or code cannot work until it is done, SQL suffices, only on tables created in its own release (never a sign-in or ingest table) | `data`   | `blocking`   | inside `upgrade`, at its own release, before the next      |
| Per tenant, with a legacy path served until a proof passes                                                                                               | `tenant` | `background` | on the worker, per owner                                   |
| Needs an operator's decision or arguments (plan, copy, finalize, verify)                                                                                 | none     | none         | a named task outside the ledger (section 5)                |

Default to background. `defineMigrationStep` refuses `blocking` on any kind but `data`
(`blocking_not_data`). Set `needsOldWritersGone: true` when an old image still serving would undo
or miss the work (a backfill the old build overwrites, a dual write it skips): the worker then waits
until the serving roster says every live api and worker declares this step (ADR-173 §3).

## 2. Declare it

Exemplars, both declared in the module file: `modules/suite/process/src/suite.module.ts`
(`suite:replay-scenario-facts-for-open-runs`, background, `needsOldWritersGone`, per-tenant checkpoint)
and `modules/ops/process/src/ops.module.ts` (`ops:copy-automation-migration-state`, blocking, calls
`repositories.migration` only, dry run reports `wouldCopy`). Identity's
`reopen-unproven-accounts-after-rollout` is background because it touches sign-in tables: do not
copy it into a blocking step. The binder
(`ModuleMigrationSetup`, `packages/process/src/feature-installer.ts`) gets the module's own
`repositories`, `dependencies` (peer `*Api`s), `app` and the process's projection `replayer`, never
another module's tables.

```ts
// modules/suite/process/src/suite.module.ts (abridged)
import { defineMigrationStep } from "@langwatch/upgrade/step";

export const suiteProcessModule = defineProcessModule("suite")
  // ...
  .withMigrations(({ app, dependencies, repositories }) => [
    defineMigrationStep({
      id: "suite:replay-scenario-facts-for-open-runs",
      kind: "data",
      mode: "background",
      description: "Counts scenario runs that suite runs open at deploy missed during the cut.",
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterTenantId;
        return SuiteRunReplayService.create({/* repositories, peer Api, app */}).replayOpenRuns({
          dryRun,
          signal,
          afterTenantId: typeof resumed === "string" ? resumed : null,
          onTenantDone: ({ tenantId, report }) =>
            checkpoint.save({ report: { afterTenantId: tenantId, ...report } }),
        });
      },
    }),
  ]);
```

The step body is a thin call into a service in the module's `services/` (behaviour never lives in
the module class). `run` is the whole loop: read where `resumeFrom` left off, do one committed unit,
`checkpoint.save`, stop when `signal.aborted`, write nothing when `dryRun`.

What each field must be (`packages/upgrade/src/step/migration-step.ts`; spec
`packages/process/specs/module-migrations.feature`):

- **`id`**: `<module>:<kebab-name>`, the declaring module first. `defineMigrationStep` throws
  `migration_step_declaration_refused` (`malformed_id`, `missing_description`, `blocking_not_data`);
  collection throws `migration_step_collection_refused` (`foreign_prefix`, `duplicate_id`,
  `not_a_step`; `packages/process/src/migration/migration-steps.ts`). Never reuse an id.
- **`description`**: one line, required, shown on the Upgrades page and in `upgrade status` before
  the step runs. Say what it does to the data in operator words, not how.
- **`run({ checkpoint, dryRun, signal })`** returns a report (a JSON object) the ledger keeps.
  `checkpoint.resumeFrom` is the last saved report or `null`; `checkpoint.save({ report })` records
  progress. Save after each committed batch, never before. Stop when `signal` aborts.
- **The dry run writes nothing**, not even a checkpoint, and reports what it would do.
- **`after`**: background steps it runs after (step values, or a `CodeStepId` across modules).
  **`finishBy`**: the release a background step must have finished by. **`queueWaitMs`**: a longer
  wait for the step's queue work than the default.

**Pacing.** A background run sends on a queue list of its own (a listed run): its commands and the
jobs they cause run ahead of any backlog, and the step is done only when that work has run. Before
each `checkpoint.save` the runner waits until few of the run's own jobs remain, so save after each
bounded page of sends; one save after a whole large tenant defeats the pacing. A list is stopped
only after its work stands still for five minutes. The attempt deadline is 15 minutes: the run
aborts, keeps its checkpoint and goes back to pending. Backoff, attempt limit and leases are in
`background-steps.service.ts`.

**One pass per table** (Alex, 2026-10-12). A step that walks a table records every event it needs
in that one pass, in pages with `sendBatch` and stable per-row keys, not several steps walking the
same rows. Combine only where ordering between the facts allows it, and never rename or drop a
shipped step id to do it. The events go to every projection, subscriber and process manager like
any other; `backfilled` is data a consumer may read, never routing (§9).

The tasks app collects every installed module's declared steps, tenant steps included
(`app.migrationSteps(isDeclaredMigrationStep)`, `apps/tasks/src/upgrade.ts`), and the run-once
worker runs the blocking ones inside `pnpm task upgrade`; a serving worker collects the background
ones and runs them (`packages/process/src/process-server.ts`,
`packages/upgrade/src/background/background-steps.service.ts`).
A module lane declares the step and tests it; it adds no runner call.

## 3. Blocking steps are frozen SQL

The image carries only the newest code. When release N+1's blocking step runs during a jump to N+3,
the schema is at N+1 and the N+3 Prisma client names fields that do not exist yet. So a blocking step:

- touches only tables created in its own release, and never a table the sign-in or ingest doors
  read or write (`upgrade-sign-in-tables` policy; anything older is a background step);
- runs raw SQL against **its own release's schema**, naming every column;
- reaches its tables only through its owner's `prisma.<subject>-migration.repository.ts` (the seam
  the `prisma-migration-access` policy polices) or a ClickHouse query;
- imports no service, no peer `*Api`, no model client;
- is **immutable once released**, like a merged migration.

`modules/ops/process/src/repositories/prisma/prisma.ops-migration.repository.ts` is the seam for
`ops:copy-automation-migration-state` (raw SQL through the owner's migration repository). A step that calls the typed client is background, never blocking.

## 4. Four properties every step has

**Idempotent and checkpointed.** A run interrupted anywhere is finished by the next run from its
checkpoint; a second full run changes nothing. Key every write on the row, never on a counter.

**Level-triggered.** Decide what to do from the data as it is now (`findUncopied`), never from an
event seen or a flag set. Old pods keep writing the old place during the rollout and after a
rollback; a rollback reopens the step, so the re-run starts whole (a replay step keeps its
completed cursor, section 8).

**Copy, never move.** Write only to new places and leave the source intact; readers switch in a
later release. Deleting the old copy is an operator step confirmed in Ops once safe, never SQL in a
migration (the `postgres-migration` skill).

**Archive-or-fail** (record, ARCHIVE-OR-FAIL) is history: the archive runner
(`packages/upgrade/src/runner/contract-archive/`) still copies a table a shipped contract retires
into `_retired_<table>_<release>`, but it gives no permission for a new automatic drop.

## 5. Tenant steps and operator tasks

The `system-migrations` skill is the full guide to the runner, pacing and Ops actions; this is the short form.

A tenant step migrates one tenant at a time. Declare it as `defineMigrationStep({ kind: "tenant",
mode: "background", tenants: "organization" | "project" | "user", title, description,
requiresOperatorConfirmation, runsAutomaticallyOnSelfHosted, enrolledAutomatically, migrateTenant })`
(exemplars: `modules/prompt/process/src/prompt.module.ts`, `modules/automation/process/src/automation.module.ts`).
The framework keeps each tenant's state in `_langwatch_upgrade_tenant_state`; the upgrade asks a
worker for one pass, and Ops can enrol, run one tenant, assert the writers have drained and roll
back. `migrateTenant` is safe to re-run and self-proving: `finalized` once the proof passes,
`migrated` (held, legacy path kept) when it disagrees, `parked` when work may have committed without
its follow-up, `rolled_back` a terminal operator pin. The step is `done` only when every eligible
tenant has a finished row. A pass paces by the step's own queue work (default 5,000 of its own
jobs); `migrateTenant` receives `waitForRoom` to await between pages of commands. Declare
`candidateTenants` so a pass walks only tenants with work (three boot loops came from passes over
every user: #8244, #8247, #8249).

A tenant declaration also carries `migratedIsSteady` (a step that reports `migrated` by design) and
`pauseWhileQueuedAbove`. No module answers `registeredMigrations()` any more; a moved migration's
old state rows are copied, never moved, by an ops step (`identity.module.ts`, `authz.module.ts`).

An operator-started job with arguments is not a release step: it stays a named task outside the
ledger, safe to run again (object-storage move: `modules/stored-object/process/src/tasks/object-storage-migrate.task.ts`,
`plan`, `copy`, `finalize`, `verify`; also credential resealing). No `procedure` or `operator` step
is declared in the tree. A re-run of a release backfill is Retry on its registered step, never a
second task that calls the same code.

## 6. Test it

Unit, over the module's memory twins, calling the declared step's `run` with a test checkpoint:

```ts
const saved: MigrationStepReport[] = [];
const checkpoint = { resumeFrom: null, save: async ({ report }) => void saved.push(report) };
const run = (dryRun: boolean) =>
  step.run({ checkpoint, dryRun, signal: new AbortController().signal });
```

- **Twice is once**: run, run again; the second reports nothing to do.
- **Dry run writes nothing**: no row and no checkpoint saved.
- **Resume**: pass the first batch's report as `resumeFrom`; the run continues after it.
- **Old writer after the run**: write through the old path, re-run, the new place caught up.
- **Source intact** after the run.
- **Blocking**: the SQL runs against a fixture at its own release's schema (integration, local
  services named in your manifest). A multi-release jump steps the schema release by release
  (`releaseSteppingApplier`, `packages/upgrade/src/runner/release-stepping-applier.ts`), but a one-release upgrade or the
  unreleased tail applies it in one pass: name every column and rely on nothing a later release adds.
- **Declaration**: an installation test asserts the module's steps collect (`migrationStepsOf`,
  `packages/process/src/__tests__/migration-steps.unit.test.ts`).
- **End to end**: the live api and worker suites run `upgrade` once per process
  (`apps/api/src/__tests__/live-upgrade.fixture.ts`); never call the runner from a unit test.

## 7. What fails, and what the operator sees

A blocking step that throws ends the run `step_failed` (exit 1); the ledger keeps its error and
checkpoint, `pnpm task upgrade status` and the Upgrades page show both, and the next `upgrade`
resumes it. The console names it before and after: `blocking step <id> started (from the start |
resuming from its checkpoint): <description>`, then `done in N ms` or `failed after N ms: <error>`
(`packages/upgrade/src/runner/run-log.ts`). A background step runs on the worker, which logs `background step started`, `done` or
`failed` (with `step`, `module` and the error) and records `failed` with its error in the ledger. Your `description` and error message are what an operator reads:
write both in operator words and name no secret (the console masks URLs and `key=value` secrets, not
prose).

Testing discipline: `.claude/skills/core/testing-rules.md`.

## 8. Projection replay steps

A new read model over events already in a log (a peer lane over another module's events, or a new
lane on your own pipeline) is filled at deploy by `defineProjectionReplayStep` (`@langwatch/upgrade/step`),
never by asking an operator to run a replay. It is a `data` step in `background` mode on the worker:

```ts
// enterprise/modules/scim/process/src/scim.module.ts (abridged)
.withMigrations(({ replayer }) => [
  defineProjectionReplayStep({
    id: "scim:replay-sso-connection-view",
    description: "Fills SCIM's SSO connection view from identity's connection log at deploy.",
    lane: `${PIPELINE_NAME}.${PROJECTION_NAME}`, // the projection, local or peer
    needsOldWritersGone: true, // an old worker does not know the new lane
    trailingPass: true, // replay once more from the cursor, to catch the overlap
    replayer, // handed to the binder by the process
  }),
])
```

Governance's `governance:replay-cost-charges` bounds the replay with `since`.

- **`replayer` comes from the binder**, never built by the module: the process composes it
  (`processProjectionReplayer`, `packages/process/src/migration/projection-replayer.ts`); a process with none
  refuses the step.
- **`since`** (optional, default the start of the log, `PROJECTION_REPLAY_FROM_START`) is the instant
  a first run replays from; a handed-over fold sets it to refold only the deploy overlap (record §9).
- **Cursor checkpoint.** The report carries `replayedThrough`, the instant taken before discovery; a
  re-run (a rollback reopening the step) passes it back as `since`, so only aggregates touched after
  it are rebuilt, each from its whole history. Nothing new: nothing written. An interrupted run
  instead resumes from `runReplaysThrough` and `lastTenantDone`; batch saves keep the previous
  cursor and renew the lease.
- **Pause and resume** are the engine's: each batch pauses the lane's live delivery
  (`<pipeline|global>/projection|handler/<lane>`), takes cutoffs, unpauses, then writes behind its
  cutoff markers. A failed batch throws `projection_lane_replay_failed`; the engine's markers make the
  next attempt skip finished aggregates. An unknown lane throws `projection_lane_not_found`.
- **Map lanes** re-append on a re-run of an aggregate; their store must dedupe (a ClickHouse
  ReplacingMergeTree keyed on the record), as an operator replay already requires.
- Spec: `specs/upgrade/projection-replay-step.feature`. Tests: the step over a fake replayer
  (`packages/upgrade/src/step/__tests__`), the lane over the real engine
  (`packages/eventing/src/replay/__tests__/projectionLaneReplay.unit.test.ts`).
