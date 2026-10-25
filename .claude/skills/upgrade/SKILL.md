---
name: upgrade
description: "How the upgrade system works end to end, for an engineer changing or debugging it: `pnpm task upgrade` (`status`, `plan`, `steps`), the ledger schema, the runner lease and the serving roster, release manifests in `packages/upgrade/releases/`, blocking, background and operator steps, `.withMigrations`, the code-step generator and `code-step-ids.generated.ts`, operator steps, the serving gate, rollback, the Ops Upgrades console and `retryStep`, the worker running the upgrade, serving while upgrading (no holds, `upgrade_in_progress`, `ClickHouseColumns`), the first-install token console, and how to test it (live fixture, migration-compat, rehearsal, upgradelab). Use when someone says 'how does the upgrade work', 'pnpm task upgrade', 'the ledger', 'upgrade lease', 'serving roster', 'serving gate', 'refuses to serve', 'behind this image', 'release manifest', 'stamp the release', 'code-step-ids', 'image-code-steps', 'CodeStepId', 'operator step', 'upgrade_in_progress', 'serves while upgrading', 'no holds', 'token console', 'the worker runs the upgrade', 'rollback reopened', 'Upgrades page', 'retry a failed step', 'upgradelab', 'upgrade rehearsal' or 'migration-compat'."
user-invocable: true
argument-hint: "<the part of the upgrade you are changing or debugging>"
---

# The upgrade system

Record: `dev/docs/ARCHITECTURE.md` §7 ("Upgrades run on deploy", no required stop);
`dev/docs/adr/173-upgrades-run-on-deploy.md`; ADR-155 for the window. Writing a migration is the
`migration` skill; operator view is `docs/self-hosting/upgrade.mdx`.

## The shape

```
new image ─► worker boot ─► gate.admit (behind or first install)
                 │            lease `upgrade` free? ─► the upgrade in this process (runImageUpgrade)
                 │              over the installed modules booted in the tasks role (bootModules)
                 │            held by a peer / failed run ─► wait, re-ask every 10 s, wait for Retry
                 │              ledger schema, lease, seed, plan
                 │              per release: schema (Prisma, goose programs) ─► blocking steps
                 │              ─► blocking done: a serving worker is admitted here
                 │              ─► reconcilers (TTL, `pnpm task upgrade lwql-provision`, pass request:
                 │                 a serving worker's run only, never the run-once `pnpm task upgrade`)
                 │                 finish beside it; a run-once worker waits for all of them
                 ▼
             ledger current ─► takes jobs ─► background steps (per-step leases, own queue lists)

new image ─► api boot (beside the worker, never after it) ─► never runs a step
   any blocking step outstanding       ─► UPGRADING: every route serves at once, not ready (NO-HOLDS)
     Postgres ahead of the schema       ─► 503 upgrade_in_progress (retry); ClickHouse ─► column default
     first install failed               ─► token console in front of every route but health
   ledger current (re-read every 10 s) ─► SERVING ─► roster row every 15 s
```

Entry points (`specs/upgrade/entry-points.feature`, UPGRADE-IN-WORKER): the worker is the one
runner of an image; every entry point reaches it. `pnpm task upgrade` is a run-once worker (Alex,
2026-10-11): it starts `apps/worker` with `upgrade`, which runs the upgrade once in-process and
exits 0, 1 or 3; `status`, `plan` and `steps` stay reads in the tasks app and write nothing. Helm upgrade: new worker pods run it, new api
pods hold not ready, and the pre-roll Job renders only with `serializeUpgrades` (never a
pre-install or pre-rollback hook). Helm with `workers.enabled: false`: each app pod carries the
worker as a sidecar (metrics on 9465, so it never clashes with the api's 9464). Compose has no
`migrate` service. The npx server has no migration phase (`doctor` prints `upgrade status` via
`printUpgradeStatus`, `apps/server/src/cli.ts`). `pnpm dev` and haven run `start:prepare:db`
(`pnpm task upgrade` alone) once before the lanes. The root `prisma:migrate` and
`clickhouse:migrate` scripts are aliases of the same command, so they go through the ledger too.

## Where it lives

| Piece                                                           | File                                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Task (run-once worker), `status`, `plan`, `steps`               | `apps/tasks/src/upgrade.ts`; the run-once mode is `apps/worker/src/main.ts` (`upgradeOnce`)                                              |
| The composed runner: Prisma, goose, reconcilers, hints          | `packages/upgrade/src/runner/image-upgrade.ts`, `release-stepping-applier.ts`                                                            |
| The worker's in-process run and its modules                     | `packages/upgrade/src/gate/in-process-upgrade.ts`; `bootModules` from `packages/process/src/preamble.ts`                                 |
| Runner, phases, outcome codes and exit codes                    | `packages/upgrade/src/runner/upgrade-runner.ts`, `upgrade-outcome.ts`, `run-phases.ts`                                                   |
| Lease (ttl 60 s, heartbeat 15 s, wait 10 min)                   | `packages/upgrade/src/runner/runner-lease.ts` (`DEFAULT_LEASE_TIMING`)                                                                   |
| Ledger kinds, modes, statuses                                   | `packages/upgrade/src/ledger.ts`                                                                                                         |
| Ledger schema and tables                                        | `packages/upgrade/src/ledger-tables.ts`                                                                                                  |
| Plan, `after` ordering                                          | `packages/upgrade/src/plan/plan-upgrade.ts`                                                                                              |
| Installed release inferred from the ledger                      | `packages/upgrade/src/runner/installed-release.ts`                                                                                       |
| One release at a time                                           | `packages/upgrade/src/stepping/` (`apply-release.ts`, `rerunnable-migrations.ts`)                                                        |
| Manifests                                                       | `packages/upgrade/releases/*.json`, `packages/upgrade/src/manifest/`                                                                     |
| Step declaration                                                | `packages/upgrade/src/step/migration-step.ts`, `projection-replay-step.ts`                                                               |
| Collection over the installed list                              | `packages/process/src/migration/migration-steps.ts`                                                                                      |
| Serving gate; the worker's wait loop (`admitAfterFirstInstall`) | `packages/process/src/migration/upgrade-gate.ts` → `packages/upgrade/src/gate/serving-upgrade-gate.ts`                                   |
| Liveness door and the token console                             | `packages/process/src/lifecycle/liveness-thread.ts`                                                                                      |
| `upgrade_in_progress` mapping (all transports)                  | `packages/api/src/errors.ts` (`promoteStoreFailure`)                                                                                     |
| Defensive ClickHouse reads                                      | `packages/clickhouse-client/src/present-columns.ts` (`ClickHouseColumns`)                                                                |
| Roster and rollback                                             | `packages/upgrade/src/serving-roster/` (`rollback.ts`)                                                                                   |
| Background steps on the worker                                  | `packages/upgrade/src/background/background-steps.service.ts`                                                                            |
| Status reader (CLI, Ops, Checkup)                               | `packages/upgrade/src/reader/`                                                                                                           |
| Ops console                                                     | `modules/ops/process/src/services/ops-upgrade.service.ts`, `transport/ops-upgrade.trpc.ts`, `modules/ops/browser/src/features/upgrades/` |
| Tenant (system) migrations                                      | `modules/ops/process/src/features/system-migrations/`, `tasks/system-migrations-pass.task.ts`                                            |

## The ledger

Its own Postgres schema, `<installation schema>_upgrade_ledger` (round 21), created before anything
else so it exists before Prisma's first deploy. Tables (`LEDGER_TABLE`): `_langwatch_upgrade_run`,
`_langwatch_upgrade_step`, `_langwatch_upgrade_target` (one row per ClickHouse target),
`_langwatch_upgrade_lease`, `_langwatch_serving_roster`, and `_langwatch_upgrade_tenant_state` (the
framework's per-tenant state for tenant steps). A role without `CREATE` ends the run
`schema_failed`. A first run on a populated database seeds the ledger from what is already applied
(`ledger-seed.service.ts`, `seed-sources.ts`).

Step kinds: `postgres-schema`, `clickhouse-schema`, `data`, `tenant`, `procedure`, `event-upcast`.
Modes: `blocking` (in `upgrade`, before serving; only `data` may block, frozen SQL), `background`
(worker, after the last release), `operator` (an operator starts it). Statuses: `pending`,
`running`, `done`, `not-needed`, `failed`, `gated`.

## Release manifests

`packages/upgrade/releases/<release>.json` is `{ release, previous, cutAt, steps[] }`
(`releaseManifestSchema`). CI stamps it on the release PR with `packages/upgrade/scripts/stamp-release.ts`
(`stamp-release-manifest` job, `.github/workflows/release-please-sdks.yml`); never hand-write one.
The stamp names every tree step no earlier manifest or the baseline names, code steps from
`releases/image/code-steps.json` included, and refuses when the tree would still not name itself
the release. `packages/upgrade/scripts/check-release-manifest.ts` (`releaseIdentityRefusal`) fails
the release PR (`release-manifest-check.yml`) and the image publish (`publish-docker-app.yml`)
while the manifest is missing: release-please rewrites the branch on each merge to main and drops
the stamp commit until the job pushes it again. Make the `Release manifest` check required on `main`.
Steps the image ships that no manifest lists yet are "unreleased" and run in one pass at the end.

No release is a required stop on the way to the latest (Alex, 2026-10-11): any install upgrades straight to the
latest image, which plans every release after the installed one and the worker rolls through every
step. An install older than the first manifest's `previous` (the 3.18.1 baseline) plans from the
baseline; settled schema no manifest names is inferred there too (`runner/installed-release.ts`).

## Declaring code steps

`defineMigrationStep` in the owning module's `.withMigrations`, id `<module>:<kebab-name>`;
recipe in `migration-data-step`. The run-once worker (or a serving worker at boot) runs the blocking
ones and the worker the background ones. Every role runs the migration binders (the api feeds tenant
steps to Ops), but the api never executes a schema or blocking step. Ordering:

- `after: [step]` (value, or a foreign id typed as `CodeStepId`): only background steps; the worker
  holds it `waiting` until each named step is `done` or `not-needed` (STEP-AFTER).
- Unknown id: `step_after_unknown`; cycle: `step_after_cycle`, both refused when the upgrade plans.
- Nothing is deleted automatically (Alex, 2026-10-11): a drop is an operator step confirmed in Ops once safe. The upgrade
  registers operator steps pending and never runs them, nor any background step. Ops today
  offers reads, Retry (failed rows only) and tenant actions, not a generic "start this operator
  step", and no operator step is declared yet: a new drop waits for that action; never bridge the
  gap with SQL in a migration.
- A re-run goes through the registered step (Retry on Ops > Upgrades, under the lease and the
  writer gate), never a separate one-shot task that calls the same code (ARCHITECTURE.md §7).
  Operator-started jobs outside the ledger (credential resealing, object-storage moves) stay
  named tasks.
- One pass per table: a step that walks a table records every event it needs in that pass, in pages
  with `sendBatch`, rather than several steps walking the same rows.

**After adding, renaming or removing a code step**, regenerate from the root:

```bash
node --experimental-transform-types packages/upgrade/scripts/image-code-steps.ts          # write
node --experimental-transform-types packages/upgrade/scripts/image-code-steps.ts --check  # CI form
```

It runs `pnpm task upgrade steps --json` and writes the committed step list
(`packages/upgrade/releases/image/code-steps.json`) plus
`packages/upgrade/src/step/code-step-ids.generated.ts` (the `CodeStepId` union). Commit both
(`packages/upgrade/specs/image-code-steps.feature`).

## Background work paces by its own queue work

Each background run sends on a list of its own (a listed run). The worker's listed consumer runs
that list, and the follow-on jobs its commands cause, ahead of any backlog; two listed runs take
turns. A step is done only when its listed work has run, not when `run` returns. Before each
checkpoint save the runner waits until few of the run's own jobs are outstanding, so save between
bounded pages (a checkpoint after a whole large tenant defeats the pacing). The stall wait is five
minutes (Alex, 2026-10-12): a list counts as stopped only after its work stands still that long.
A run has a 15-minute attempt deadline; it aborts, keeps its checkpoint and goes back to pending.
Specs: `specs/upgrade/background-steps.feature`. Tenant steps pace the same way (`system-migrations`
skill); running the whole upgrade under traffic is the `upgradelab` skill.

## Serving while upgrading (no holds)

The api holds nothing (Alex, 2026-10-09, NO-HOLDS): from boot it serves every REST, tRPC and SSE
route and reports not ready until the ledger is current, so a rolling deploy keeps the old pods
serving. A Postgres query the schema is not ready for (P2021/P2022, 42P01/42703) becomes the
handled `upgrade_in_progress` (503, `Retry-After: 10`) in `promoteStoreFailure`, the one mapping
every transport uses; the browser's query client keeps retrying it with backoff. A repository
reading a column a pending ClickHouse step adds selects it through `ClickHouseColumns`, which
answers its typed default until the target has it. Ingest only enqueues, and a blocking step may
not touch a sign-in or ingest table (`upgrade-sign-in-tables` policy). A failed step of either
store shows on Ops > Upgrades with Retry; only a failed first install opens the token console.
Specs: `specs/upgrade/in-app-upgrade.feature`, `packages/process/specs/upgrade-holding-page.feature`.

## Serving gate, roster and rollback

The gate refuses to start, by name, while a blocking step of the image is not `done`/`not-needed`,
or ClickHouse is missing (`NO_CLICKHOUSE_REFUSAL`). Admitted, a
process writes a roster row every 15 s; the stale bound is generous so a database blip never takes
a process out of service (`serving-upgrade-gate.ts`). Background steps with `needsOldWritersGone`
wait until every live row declares them. A rollback is an older image's live row after the last
finished run: it reopens level-triggered background steps newer than that image, never one
shipped at or below its release (`rollback.ts`). There is no down migration; the way back is the previous image on the new schema.

## The Ops Upgrades console

`/ops/upgrades`, platform operators. Reads ask `ops:view`; `retryStep` asks `ops:manage` and returns
a failed step (background or schema) to `pending`; for a Prisma folder it also records consent to
rerun it (refuses `upgrade_step_not_failed` otherwise). The page
refreshes on the runner's read hint, never a timer. Seven installation states: Up to date,
Finishing in background, Behind, Never upgraded, Upgrading, Rolled back, Needs attention. Specs: `modules/ops/specs/upgrades.feature`, `upgrade-alerts.feature`,
`upgrades-checkup.feature`.

## Test it

| What                             | How                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan, stepping, gate, reader     | unit and integration suites in `packages/upgrade` (`specs/upgrade/*.feature`, `packages/upgrade/specs/`)                                                                                                                                                                                                                                         |
| Code step list drift             | `image-code-steps.ts --check` (above)                                                                                                                                                                                                                                                                                                            |
| Whole upgrade on test stores     | `apps/api/src/__tests__/live-upgrade.fixture.ts` (`specs/upgrade/live-test-fixtures.feature`)                                                                                                                                                                                                                                                    |
| Old image on head's schema       | `.github/workflows/migration-compat.yml` (per PR, and the nightly `previous-release` job booting the newest manifest's image)                                                                                                                                                                                                                    |
| A real upgrade from an old image | `dev/scripts/upgrade-rehearsal/rehearse.sh` (`upgrade-rehearsal.yml`, manual dispatch; `specs/upgrade/upgrade-rehearsal.feature`)                                                                                                                                                                                                                |
| Matrix cells and drills          | `tools/upgradelab` (`cd tools && go run ../cmd/upgradelab generate, produce, cell, drill, snapshot ...`): old release seeded, then head's api and worker with traffic across the switch; exit 1 when an invariant fails. Details in `tools/upgradelab/README.md` (its "Not yet" list lags the code); heavy, so never start one on a busy machine |

## Never

- Run a step from the api (it declares them; the worker executes), add a `migrate` compose service or an npx migration phase, or wait without a deadline.
- Hold a request while upgrading, or map a schema error per module: `promoteStoreFailure` is the one place.
- Read a column a pending ClickHouse step adds without `ClickHouseColumns`.
- Hand-edit a stamped manifest or a merged migration.
- Write the ledger by hand to unstick a run: fix the cause and re-run `upgrade`, or `retryStep`.
