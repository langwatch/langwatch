---
name: migration-data-step
description: "Write a data, tenant or procedure step with defineMigrationStep and .withMigrations: the id `<module>:<kebab-name>`, kind, mode (blocking frozen SQL, background on the worker, operator), the required one-line description, needsOldWritersGone, and the run function with its checkpoint `{ resumeFrom, save({ report }) }`, dry-run flag and abort signal. Covers the four properties every step has (idempotent and checkpointed, level-triggered, copy never move, archive-or-fail), tenant steps (SystemMigration, the proof, per-owner state), procedure steps (storage moves), where the step's SQL may live, and how to test one. Use when someone says 'backfill', 'data migration', 'migrate the data', 'move rows', 'copy to the new column', 'fill the new column', 'migrate to object storage', 'tenant migration', 'system migration', 'held tenant', 'blocking step', 'background step', 'withMigrations', 'defineMigrationStep', 'checkpoint', 'resumeFrom', 'frozen SQL', 'level-triggered', 'idempotent backfill', 'dry run', 'archive-or-fail', or a one-shot backfill task needs converting."
user-invocable: true
argument-hint: "<what data moves, from where to where, and whether the next schema needs it done first>"
---

# Write a data step

A data step moves or reshapes data between an expand and its contract. Schema is the
`postgres-migration` and `clickhouse-migration` skills; which recipe applies at all is `migration`.
Record: ARCHITECTURE.md §7; rulings rounds 14 to 16 (`.claude/coordinator/rulings-2026-10-06-rounds.md`);
design `dev/docs/plans/migrations-rethink-2026-10-06.md`, cited "plan 6.x".

## 1. Choose kind and mode

| The step                                                                    | Kind        | Mode         | Runs                                                      |
| --------------------------------------------------------------------------- | ----------- | ------------ | --------------------------------------------------------- |
| Small, SQL only, inside one module's tables                                 | none        | none         | inline DML in the Prisma migration (`postgres-migration`) |
| Needs domain code, a peer `*Api`, object storage, events or a model         | `data`      | `background` | on the worker after the last release, newest code         |
| A later release's schema or code cannot work until it is done, SQL suffices | `data`      | `blocking`   | inside `upgrade`, at its own release, before the next     |
| Per tenant, with a legacy path served until a proof passes                  | `tenant`    | `background` | on the worker, per owner                                  |
| Needs an operator's decision or arguments (plan, copy, finalize, verify)    | `procedure` | `operator`   | only when asked                                           |

Default to background. `defineMigrationStep` refuses `blocking` on any kind but `data`
(`blocking_not_data`). Set `needsOldWritersGone: true` when an old image still serving would undo
or miss the work (a backfill the old build overwrites, a dual write it skips): the worker then waits
until the serving roster says every live api and worker declares this step (ADR-173 §3).

## 2. Declare it

Exemplar: `modules/identity/process/src/identity.module.ts` (`identity:reopen-unproven-accounts`).
The binder gets the module's own `repositories`, `dependencies` (peer `*Api`s) and config, never
another module's tables.

```ts
import { defineMigrationStep } from "@langwatch/upgrade/step";

export const datasetProcessModule = defineProcessModule("dataset")
  .withRepositories(datasetRepositories)
  // ...
  .withMigrations(({ repositories }) => [
    defineMigrationStep({
      id: "dataset:copy-records-to-object-storage",
      kind: "data",
      mode: "background",
      description: "Copies each dataset's records to object storage; the Postgres rows stay.",
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.after;
        let after = typeof resumed === "string" ? resumed : null;
        let copied = 0;
        while (!signal.aborted) {
          const batch = await repositories.migration.findUncopied({ after, limit: 500 });
          if (batch.length === 0) break;
          if (!dryRun) await repositories.migration.copy({ ids: batch.map((row) => row.id) });
          copied += batch.length;
          after = batch.at(-1)?.id ?? after;
          if (!dryRun) await checkpoint.save({ report: { after, copied } });
        }
        return dryRun ? { wouldCopy: copied } : { copied };
      },
    }),
  ]);
```

What each field must be (`packages/upgrade/src/step/migration-step.ts`; spec
`packages/process/specs/module-migrations.feature`):

- **`id`**: `<module>:<kebab-name>`, the declaring module first. A foreign prefix, a duplicate across
  the installed list or another shape is refused by name at collection. Never reuse an id.
- **`description`**: one line, required, shown on the Upgrades page and in `upgrade status` before
  the step runs. Say what it does to the data in operator words, not how.
- **`run({ checkpoint, dryRun, signal })`** returns a report (a JSON object) the ledger keeps.
  `checkpoint.resumeFrom` is the last saved report or `null`; `checkpoint.save({ report })` records
  progress. Save after each committed batch, never before. Stop when `signal` aborts.
- **The dry run writes nothing**, not even a checkpoint, and reports what it would do.

Today the step is declared and collected by the tasks and worker roles, but no app hands the steps
to the runner yet (no `.migrationSteps(...)` caller). Declare it anyway, test it over twins, and
name the gap in the handoff; do not add a runner call from a module lane.

## 3. Blocking steps are frozen SQL

The image carries only the newest code. When release N+1's blocking step runs during a jump to N+3,
the schema is at N+1 and the N+3 Prisma client names fields that do not exist yet. So a blocking step:

- runs raw SQL against **its own release's schema**, naming every column;
- reaches its tables only through its owner's `prisma.<subject>-migration.repository.ts` (the seam
  the `prisma-migration-access` policy polices) or a ClickHouse query;
- imports no service, no peer `*Api`, no model client;
- is **immutable once released**, like a merged migration.

`modules/identity/process/src/repositories/prisma/prisma.identity-backfill.repository.ts` is the
seam's shape. A step that calls the typed client is background, never blocking.

## 4. Four properties every step has

**Idempotent and checkpointed.** A run interrupted anywhere is finished by the next run from its
checkpoint; a second full run changes nothing. Key every write on the row, never on a counter.

**Level-triggered.** Decide what to do from the data as it is now (`findUncopied`), never from an
event seen or a flag set. Old pods keep writing the old place during the rollout and after a
rollback; a rollback reopens the step with its checkpoint cleared, so the re-run is whole.

**Copy, never move.** Write only to new places and leave the source intact; readers switch in a
later release. Deleting the old copy is a contract step under the floor rule, with
`-- contract: retired in <release>` (the `postgres-migration` skill).

**Archive-or-fail** (plan 6.8). When a contract drops a tenant step's legacy source, it first copies
the still-held tenants' rows into a retained `_retired_<table>`, marks them `failed`, named and
alerted, then drops. Nothing waits on a held tenant.

## 5. Tenant and procedure steps

A tenant step is a `SystemMigration` (`packages/system-migrations/src/system-migration.ts`), answered
through its owner's `registeredMigrations()` (§7) and run by the system-migrations pass, which runs
after `upgrade` in `start:prepare:db` and hourly on the worker (`ops_system_migrations`).
`migrateTenant` is safe to re-run and self-proving: `finalized` once the proof passes, `migrated`
(held, legacy path kept) when it disagrees, `parked` when work may have committed without its
follow-up. Never `executionMode: "startup"`. Declare `candidateTenants` so a pass walks only tenants
with work (three boot loops came from passes over every user: #8244, #8247, #8249). Exemplar:
`modules/identity/process/src/services/system-migration-identity-identifier-backfill.service.ts`.

A procedure is an operator step with arguments: the object-storage move
(`modules/stored-object/process/src/tasks/object-storage-migrate.task.ts`, `plan`, `copy`, `finalize`,
`verify`). Copy and finalize are separate invocations so the old provider stays readable until
finalize.

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
  services named in your manifest).
- **Declaration**: an installation test asserts the module's steps collect (`migrationStepsOf`,
  `packages/process/src/__tests__/migration-steps.unit.test.ts`).
- **End to end**: the live api and worker suites run `upgrade` once per process
  (`apps/api/src/__tests__/live-upgrade.fixture.ts`); never call the runner from a unit test.

Testing discipline: `.claude/skills/core/testing-rules.md`.
