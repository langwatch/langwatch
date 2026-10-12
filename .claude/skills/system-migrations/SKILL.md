---
name: system-migrations
description: "Per-organisation (per-tenant) migrations and how they are paced: a declared tenant step (defineMigrationStep kind 'tenant' on .withMigrations), the runner in packages/system-migrations (leases, cohort, state machine pending/migrated/finalized/parked/rolled_back, held tenants, the proof), pacing on the step's own queue list (pauseWhileQueuedAbove, default 5,000, waitForRoom), group-queue listed runs (runListedWork, follow-on jobs run ahead of the backlog, the stall wait), the system-migrations pass at upgrade and hourly, and the legacy registeredMigrations() path being converted. Use when someone says 'tenant migration', 'system migration', 'migrateTenant', 'SystemMigration', 'held tenant', 'parked', 'finalized', 'rolled back', 'pauseWhileQueuedAbove', 'waitForRoom', 'runListedWork', 'listed run', 'queue list', 'migration floods the queue', 'candidateTenants', 'migratedIsSteady', 'registeredMigrations', or 'convert a legacy migration to withMigrations'."
user-invocable: true
---

# Tenant migrations (system migrations)

Record: `dev/docs/ARCHITECTURE.md` section 7, the tenant-migration paragraph that starts "A tenant migration is a
`kind: "tenant"` step" (about line 1494), and the group-queue paragraph in section 9 on listed runs. Specs:
`specs/migration/system-migrations-runner.feature`, `specs/upgrade/background-steps.feature`. The step file format, ids, the
checkpoint and the other step kinds are in `migration-data-step`; the overall upgrade flow is in `upgrade`. This skill is
the per-organisation part and the queue pacing.

## What it is

A one-time, in-place change for each tenant (organisation, project or user) that has a legacy path to serve until a
proof passes. Not for schema (`postgres-migration`, `clickhouse-migration`) and not for a plain backfill that touches
every row the same way (`migration-data-step`, a background step).

## Declare it

The owning module declares it, with the state in one framework table (`_langwatch_upgrade_tenant_state`):

```ts
.withMigrations(({ repositories }) => [
  ClickHouseImportStoredObjectMigration.create({ legacy: repositories.legacySource, records: repositories.records }).step(),
])   // modules/stored-object/process/src/stored-object.module.ts:27
```

The step itself (`modules/stored-object/process/src/migrations/clickhouse-import.stored-object.migration.ts:48`) is
`defineMigrationStep({ id: "stored-object:import-clickhouse-index", kind: "tenant", mode: "background", tenants: "project",
needsOldWritersGone, title, description, requiresOperatorConfirmation, runsAutomaticallyOnSelfHosted,
enrolledAutomatically, migrateTenant })`. The four flat fields are what only a tenant step accepts; the name, the id,
is the state key and is never renamed.

## `migrateTenant` rules

- Safe to re-run every pass, and self-proving. Return `finalized` only when the tenant verifiably behaves the same without
  its legacy path; `migrated` when the proof disagrees (the tenant is **held**, legacy path kept, and a later pass
  re-verifies); `parked` when it errored or work may have committed without its follow-up (retried later, never fatal).
- `rolled_back` is the operator's status, set in Ops; the runner never writes it and never acts on it afterwards.
- Receive `previous` (a parked last attempt means redo, not short-circuit), `signal` (honour it between pages) and
  `waitForRoom` (below). Copy, never move; the source stays intact.
- `candidateTenants` narrows the walk to tenants with work; without it every tenant is visited each pass (three boot loops
  came from that, `migration-data-step` section 5). `migratedIsSteady: true` is for a step that reports `migrated` on
  every pass by design; those tenants are not counted as held.
- A step that must read every tenant reads through its owner's repository with `skipTenantCheck` and a reason (`authorization`).

## The runner

`packages/system-migrations/src/runner.service.ts`: one lease per pass fleet-wide, one claim per organisation (60 s, renewed
every 20 s), 25 organisations at once, paged by 100. Self-hosted migrates every tenant silently; cloud takes only the
tenants a migration's `enrolledAutomatically` covers or an operator enrolled. Level-triggered: passes repeat until nothing
advances (`convergence.ts`, at most 25 passes, 5 s apart; a pass that fails to settle logs an error and claims nothing).
A tenant step settles done only when every eligible tenant has a finished row. Passes run after the upgrade completes
and hourly on the worker; the Ops > Upgrades page lists held and parked tenants and offers enrolment, a targeted run and rollback
(`modules/ops/process/src/transport/ops-upgrade.trpc.ts`). "No holds" in the serving rule is about HTTP requests during a
schema upgrade; a held tenant is a different thing.

## Pacing: the step's own queue list

A migration that sends many commands must not flood the queue ahead of live work.

- The runner runs a paced pass inside `runListedWork` (`packages/group-queue/src/groupQueue.ts:3028`): the pass opens a
  list, every command it sends and every job those cause is on that list, and a consumer started with `dispatchListed`
  runs list jobs **ahead of the ordinary backlog**. Follow-on jobs (the job a handler sends) stay on the list, so a second
  listed run takes turns rather than waiting behind the first.
- A pass starts no new page of tenants while more than `pauseWhileQueuedAbove` of its OWN jobs wait or run. The default on
  a list is `DEFAULT_PAUSE_WHILE_QUEUED_ABOVE` = 5,000 (`runner.service.ts:33`); a migration may declare a lower
  number. Without a list the count is the whole queue's, and a failed read counts as over the limit.
- Inside one tenant, `await waitForRoom?.()` between pages of commands. It resolves when the pass is under its bound, or
  when the signal aborts. One save or one send after a whole large tenant defeats the pacing.
- The list closes in a `finally`. The run returns only when its listed work has run; a blocked or failed group fails the
  run with its name; a list whose work stands still for the stall wait fails with the waiting groups named.
- The stall wait is the `timeoutMs` the caller passes to `runListedWork`; the ruling is five minutes (Alex, 2026-10-12,
  `specs/upgrade/background-steps.feature:208`), because a busy worker is not a stalled one. The callers still pass 60,000:
  `PASS_QUEUE_WAIT_MS` (`runner.service.ts:35`), `BACKGROUND_STEP_QUEUE_WAIT_MS`
  (`packages/upgrade/src/background/background-steps.service.ts:109`; a step may set `queueWaitMs`) and `PASS_REQUEST_WAIT_MS`
  (`packages/upgrade/src/gate/in-process-upgrade.ts:63`). Only the preflight drain default is 300,000
  (`groupQueue.ts:522`). Read the constant before quoting a number, and when you touch one, move it to the ruling.
- A background (non-tenant) step has the same list and also waits, before saving a checkpoint, until at most 1,000 of its
  own jobs are outstanding (`BACKGROUND_STEP_MAX_OUTSTANDING_JOBS`). Save between bounded pages.
- A fact event restoring state (`data.backfilled === true`) updates state without creating follow-on subscriber jobs.

## The legacy path

No module answers `registeredMigrations()` or `userMigrations()` any more: identity, authz and
automation declare their tenant steps with `.withMigrations`, and Ops' pass drives declared steps
only. A `SystemMigration` class may still do a step's work, handed to `defineMigrationStep` by an
app method (`authz.module.ts`, `identity.module.ts`, `automation.module.ts`). A migration that
moves to a new step id has its `finalized` and `rolled_back` rows and enrolments copied, never
moved, by an ops background step, and copied again once no older image writes the old table
(`ops:copy-identity-authz-migration-state`, `ops:recopy-identity-authz-migration-state-after-rollout`).

## Testing

Unit: call `migrateTenant` over the module's memory twins and assert the status and report. Runner behaviour: the
`runner.unit.test.ts` beside it. Live: `upgradelab` seeds tenants on main and judges the held tenants and the queue (A1 to A4, N4, Q1).
