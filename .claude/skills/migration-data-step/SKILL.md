---
name: migration-data-step
description: "Write a data, tenant or procedure step under the ruled migration design: choosing blocking (frozen SQL pinned to its own release's schema) or background (live domain code on the worker after the last release) or operator, and the four properties every step has: idempotent and checkpointed with one dry-run flag, level-triggered, copy never move, archive-or-fail for tenants still held when their source is dropped. Covers tenant steps (SystemMigration, the proof, per-owner state), procedure steps (storage moves), where the step's SQL may live, and how to test one. Use when someone says 'backfill', 'data migration', 'move rows', 'copy to the new column', 'migrate to object storage', 'tenant migration', 'system migration', 'held tenant', 'blocking step', 'background step', 'frozen SQL', 'level-triggered', 'idempotent backfill', 'dry run', 'archive-or-fail', or a K4 task needs converting."
user-invocable: true
argument-hint: "<what data moves, from where to where, and whether the next schema needs it done first>"
---

# Write a data step

A data step moves or reshapes data between an expand and its contract. Schema itself is the
`postgres-migration` and `clickhouse-migration` skills; which recipe applies at all is the
`migration` skill. The design is `dev/docs/plans/migrations-rethink-2026-10-06.md` (revision 4),
cited here as "plan 6.x".

## 1. Choose the mode (plan 6.1, 6.5; Alex, Q6: each step declares it)

| The step                                                                    | Mode                               | Why                                                                                              |
| --------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Small, SQL only, inside one module's tables                                 | inline DML in the Prisma migration | the simplest blocking data step; it stays allowed (plan 6.11)                                    |
| A later release's schema or code cannot work until it is done; SQL suffices | **blocking**, frozen SQL           | runs inside `upgrade` at its own release, before the next release's schema (plan 6.4)            |
| Needs domain code, a peer `*Api`, object storage, events or an LLM          | **background**                     | runs on the worker after the last release, against the newest schema and code (plan 6.5 point 3) |
| Per tenant, with a legacy path served until a proof passes                  | **background**, kind `tenant`      | the proof re-runs each pass (plan 6.12, "Tenant step")                                           |
| Needs an operator's decision or arguments (plan, copy, finalize, verify)    | **operator**, kind `procedure`     | runs only when asked (plan 6.1, K7)                                                              |

Default to background. Frozen SQL is harder to write than service code and most moves need
neither its ordering nor its constraints (plan 10).

## 2. Blocking steps are frozen SQL (plan 6.5 point 2)

The image carries only the newest code and the newest generated Prisma client. When release
N+1's blocking step runs during a jump to N+3, the schema is at N+1, and the N+3 client selects,
returns and defaults fields that do not exist yet. So a blocking step:

- is written in raw SQL against **its own release's schema**, naming every column explicitly;
- reaches its own tables only through its owner's `prisma.<subject>-migration.repository.ts`
  (the seam the `prisma-migration-access` policy polices), or a ClickHouse query;
- imports nothing else: no service, no peer `*Api`, no model client;
- is **immutable once released**, like a merged migration (`specs/ci/migration-order.feature`).

Today's `*-migration.repository.ts` files are not frozen SQL:
`modules/dataset/process/src/repositories/prisma/prisma.dataset-migration.repository.ts` calls the
typed client, which is why its backfill becomes a background step (plan 8, S7). The frozen-step lint
rule lands with S7; until then a reviewer checks the four bullets by hand.

## 3. Four properties every step has

**Idempotent and checkpointed, with one dry-run flag** (plan 6.11). A run interrupted anywhere is
finished by the next run, from its checkpoint in the ledger. The dry run reports what it would do
and writes nothing. Exemplar: `DatasetMigrationService.migrateDataset` in
`modules/dataset/process/src/services/dataset-migration.service.ts` returns `would-migrate` on a dry
run and `already-migrated` when the work is done.

**Level-triggered.** The step decides what to do from the data as it is now, never from an event
it saw or a "done" flag it set. Old pods keep writing the old place during and after the rollout
and do not know the new one (`docs/self-hosting/upgrade-dataset-storage.mdx`, the warning before
"resilient by design"), so a re-run must pick up what they wrote since (plan 6.12, "Data step").
The dataset exemplar asks `isPostgresLayout` per dataset instead of trusting a marker.

**Copy, never move.** Write only to new places and leave the source intact; readers switch in a
later release. The dataset backfill keeps every Postgres row as a fallback
(`docs/self-hosting/upgrade-dataset-storage.mdx`). Deleting the old copy is a destructive step
under the floor rule, and a step that says it deletes from a source needs the retirement note
(plan 6.12, enforcement item 3). Alex's oversized-payload split shows the shape: evaluation's step
copies, stored-object's own later step deletes, no cross-module call (Alex, ADR-172 open point 4).

**Archive-or-fail** (Alex, N2; plan 6.8). When a contract step drops a tenant step's legacy
source, it first copies the still-held tenants' legacy rows into a retained `_retired_<table>`
(tenant id plus the drop's release), marks them `failed` in the owner's state, named and alerted,
then drops. A source too large to copy says so in its declaration and those tenants fail without an
archive. Nothing waits. The archive is itself a retired table, dropped one LTS later.

## 4. Tenant steps

A tenant step is a `SystemMigration` (`packages/system-migrations/src/system-migration.ts`):
`migrateTenant` is safe to re-run and self-proving. Outcomes
(`packages/system-migrations/src/types.ts`): `finalized` once the proof passes without the legacy
path; `migrated` when the proof disagrees (held: the tenant stays on its legacy path); `parked` when
work may have committed without the follow-up that makes it visible (redo it).

- **Never `executionMode: "startup"`.** Tenant passes leave the boot (Alex, Q7; S5 deletes the
  mode). Pacing stays on the step: `enrolledAutomatically` and `runsAutomaticallyOnSelfHosted`; a
  gated step shows `gated`, not `pending` (plan 6.8). Exemplar of pacing:
  `modules/identity/process/src/services/system-migration-identity-identifier-backfill.service.ts`.
- **Per-tenant state belongs to the owning module** (Alex, D01): it implements the runner's state
  port over its own table, declared with its step; ops reads it through the runner, never the table.
  Identity goes first and records `finalized` at SAML adoption, so no pass visits those users. Not
  landed (S6): today every tenant step writes ops' shared `SystemMigrationTenantState` through
  `packages/system-migrations/src/state.repository.ts`.
- **A held tenant fails visibly** (S5, not landed): `held:proof` or `held:pending`, `heldSince`, an
  alert past a threshold. Today `migrated` is re-counted every pass with no alert.
- **Narrow the cohort.** A pass over every user is how three boot loops happened (plan 2, H2:
  #8244, #8247, #8249). Declare `candidateTenants` so a pass walks only tenants with work, as Alex ruled for identity's heal pass (Q64).

## 5. Procedure steps

An operator step with arguments, for work an operator must decide: the object-storage provider move
(`modules/stored-object/process/src/tasks/object-storage-migrate.task.ts`, registered by no module
today) becomes a `procedure` with plan, copy, finalize and verify as arguments (plan 6.1, S8). The
same four properties hold; copy and finalize are separate invocations so the old provider stays
readable until finalize.

## 6. Declaring it today

`.withMigrations(...)` and the ledger runner are not landed (S6, S1 to S3). Until they are:

| Mode               | Write it as                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| blocking, SQL only | DML in the Prisma migration that needs it; a batched frozen step waits for S6/S7 (ask the coordinator)                                              |
| background         | a module task, `.withTasks(...)`, over the module's own repositories; exemplar `modules/dataset/process/src/tasks/dataset-content-backfill.task.ts` |
| tenant             | a `SystemMigration` the owner answers through its `registeredMigrations()` (§7); background mode only                                               |
| procedure          | a module task with explicit arguments, as above                                                                                                     |

Write it so the move to `.withMigrations` is a declaration change: the run function takes
`{ dryRun }`, keeps its checkpoint in the owner's repository, and reads only the owner's tables
plus peer `*Api` calls.

## 7. Test it

- **Twice is once**: run the step, run it again; the second run changes nothing and reports
  nothing to do.
- **Old writer after the run**: write through the old path after a run, re-run, and assert the new
  place caught up (level-triggered).
- **Source intact**: after the run the old copy still reads as before (copy, never move).
- **Dry run writes nothing.**
- **Blocking steps** run over a fixture at their own release's schema, not head's (plan 6.9, the
  Tests row).
- Tenant steps: a disagreeing proof leaves the tenant on its legacy path and is reported, never
  retried in a loop.

Integration tests use the local services named in your manifest; testing discipline is
`.claude/skills/core/testing-rules.md`.
