---
name: upgrade
description: "How the upgrade system works end to end, for an engineer changing or debugging it: `pnpm task upgrade` (`status`, `plan`, `steps`), the ledger schema, the runner lease and the serving roster, release manifests in `packages/upgrade/releases/`, blocking, background and operator steps, `.withMigrations`, the code-step generator and `code-step-ids.generated.ts`, `-- after:` notes, the serving gate and the floor refusal, rollback, the Ops Upgrades console and `retryStep`, the npx server's upgrade, and how to test it (live fixture, migration-compat, rehearsal, upgradelab). Use when someone says 'how does the upgrade work', 'pnpm task upgrade', 'the ledger', 'upgrade lease', 'serving roster', 'serving gate', 'refuses to serve', 'behind this image', 'release manifest', 'stamp the release', 'code-step-ids', 'image-code-steps', 'CodeStepId', 'after: note', 'refused_below_floor', 'rollback reopened', 'Upgrades page', 'retry a failed step', 'upgradelab', 'upgrade rehearsal' or 'migration-compat'."
user-invocable: true
argument-hint: "<the part of the upgrade you are changing or debugging>"
---

# The upgrade system

Record: `dev/docs/ARCHITECTURE.md` §7 ("Upgrades run on deploy", the LTS paragraph after it);
`dev/docs/adr/173-upgrades-run-on-deploy.md`; ADR-155 for the window. Writing a migration is the
`migration` skill; naming an LTS is `lts-release`; operator view is `docs/self-hosting/upgrade.mdx`.

## The shape

```
deploy ─► pnpm start:prepare:db (apps/api) ─► pnpm task upgrade ─► system-migrations pass
              │                                  │
              │      ledger schema, lease, seed, floor check, plan
              │      per release: schema (Prisma, goose) ─► blocking steps ─► reconcilers
              ▼
api / worker boot ─► serving gate (admit or refuse by name) ─► roster row every 15 s
                                                   worker ─► background steps
```

Entry points (`specs/upgrade/entry-points.feature`): the Helm pre-upgrade Job, the compose `migrate`
service, the npx server (once, before its services; `doctor` prints `upgrade status` via
`printUpgradeStatus`, `apps/server/src/cli.ts`), haven, and on a Helm first install the api's first
boot (`packages/upgrade/src/gate/first-install-upgrade.ts`). api and worker never migrate.

## Where it lives

| Piece | File |
| --- | --- |
| Task, `status`, `plan`, `steps`, stepping applier | `apps/tasks/src/upgrade.ts` |
| Runner, phases, outcome codes and exit codes | `packages/upgrade/src/runner/upgrade-runner.ts`, `upgrade-outcome.ts`, `run-phases.ts` |
| Lease (ttl 60 s, heartbeat 15 s, wait 10 min) | `packages/upgrade/src/runner/runner-lease.ts` (`DEFAULT_LEASE_TIMING`) |
| Ledger kinds, modes, statuses | `packages/upgrade/src/ledger.ts` |
| Ledger schema and tables | `packages/upgrade/src/ledger-tables.ts` |
| Plan, floor refusal, `after` ordering, `-- after:` inlining | `packages/upgrade/src/plan/plan-upgrade.ts` |
| Installed release inferred from the ledger | `packages/upgrade/src/runner/installed-release.ts` |
| One release at a time | `packages/upgrade/src/stepping/` (`apply-release.ts`, `rerunnable-migrations.ts`) |
| Manifests and floor | `packages/upgrade/releases/*.json`, `packages/upgrade/src/manifest/` |
| Step declaration | `packages/upgrade/src/step/migration-step.ts`, `projection-replay-step.ts` |
| Collection over the installed list | `packages/process/src/migration/migration-steps.ts` |
| Serving gate | `packages/process/src/migration/upgrade-gate.ts` → `packages/upgrade/src/gate/serving-upgrade-gate.ts` |
| Roster and rollback | `packages/upgrade/src/serving-roster/` (`rollback.ts`) |
| Background steps on the worker | `packages/upgrade/src/background/background-steps.service.ts` |
| Status reader (CLI, Ops, Checkup) | `packages/upgrade/src/reader/` |
| Ops console | `modules/ops/process/src/services/ops-upgrade.service.ts`, `transport/ops-upgrade.trpc.ts`, `modules/ops/browser/src/features/upgrades/` |
| Tenant (system) migrations | `modules/ops/process/src/features/system-migrations/`, `tasks/system-migrations-pass.task.ts` |

## The ledger

Its own Postgres schema, `<installation schema>_upgrade_ledger` (round 21), created before anything
else so it exists before Prisma's first deploy. Tables (`LEDGER_TABLE`): `_langwatch_upgrade_run`,
`_langwatch_upgrade_step`, `_langwatch_upgrade_target` (one row per ClickHouse target),
`_langwatch_upgrade_lease`, `_langwatch_serving_roster`. A role without `CREATE` ends the run
`schema_failed`. A first run on a populated database seeds the ledger from what is already applied
(`ledger-seed.service.ts`, `seed-sources.ts`).

Step kinds: `postgres-schema`, `clickhouse-schema`, `data`, `tenant`, `procedure`, `event-upcast`.
Modes: `blocking` (in `upgrade`, before serving; only `data` may block, frozen SQL), `background`
(worker, after the last release), `operator` (an operator starts it). Statuses: `pending`,
`running`, `done`, `not-needed`, `failed`, `gated`.

## Release manifests and the floor

`packages/upgrade/releases/<release>.json` is `{ release, previous, cutAt, steps[] }`
(`releaseManifestSchema`). CI stamps it on the release PR with `packages/upgrade/scripts/stamp-release.ts`
(`stamp-release-manifest` job, `.github/workflows/release-please-sdks.yml`); never hand-write one.
Steps the image ships that no manifest lists yet are "unreleased" and run in one pass at the end.

`lts-floor.json` is `{ release, namedAt }` (`ltsFloorSchema`): the oldest release this image
upgrades from. Below it the plan refuses (`below_lts_floor` → exit 2 `refused_below_floor`, the
message names the LTS to stop at); an image older than the floor the ledger recorded refuses
`refused_image_below_floor`. The floor moves only by the `lts-release` procedure.

## Declaring code steps

`defineMigrationStep` in the owning module's `.withMigrations`, id `<module>:<kebab-name>`;
recipe in `migration-data-step`. Tasks runs the blocking ones, the worker the background ones, the
api builds none. Ordering:

- `after: [step]` (value, or a foreign id typed as `CodeStepId`): only background steps; the worker
  holds it `waiting` until each named step is `done` or `not-needed` (STEP-AFTER).
- `-- after: <step id>` in a contract's SQL beside its `-- contract: retired in` note: the upgrade
  runs that background step (and its own `after`s) inline before the contract's release
  (`inlineBeforeContracts`, STEP-AFTER-2). Unknown id: `step_after_unknown`; cycle:
  `step_after_cycle`.

**After adding, renaming or removing a code step**, regenerate from the root:

```bash
node --experimental-transform-types packages/upgrade/scripts/image-code-steps.ts          # write
node --experimental-transform-types packages/upgrade/scripts/image-code-steps.ts --check  # CI form
```

It runs `pnpm task upgrade steps --json` and writes the committed step list plus
`packages/upgrade/src/step/code-step-ids.generated.ts` (the `CodeStepId` union). Commit both
(`packages/upgrade/specs/image-code-steps.feature`).

## Serving gate, roster and rollback

The gate refuses to start, by name, while a blocking step of the image is not `done`/`not-needed`,
the release is below the floor, or ClickHouse is missing (`NO_CLICKHOUSE_REFUSAL`). Admitted, a
process writes a roster row every 15 s; the stale bound is generous so a database blip never takes
a process out of service (`serving-upgrade-gate.ts`). Background steps with `needsOldWritersGone`
wait until every live row declares them. A rollback is an older image's live row after the last
finished run: it reopens level-triggered background steps, never one retired below the floor
(`rollback.ts`). There is no down migration; the way back is the previous image on the new schema.

## The Ops Upgrades console

`/ops/upgrades`, platform operators. Reads ask `ops:view`; `retryStep` asks `ops:manage` and returns
a `failed` background step to `pending` (refuses `upgrade_step_not_failed` otherwise). The page
refreshes on the runner's read hint, never a timer. Eight installation states: Up to date,
Finishing in background, Behind, Never upgraded, Upgrading, Rolled back, Needs attention,
Unsupported. Specs: `modules/ops/specs/upgrades.feature`, `upgrade-alerts.feature`,
`upgrades-checkup.feature`.

## Test it

| What | How |
| --- | --- |
| Plan, stepping, gate, reader | unit and integration suites in `packages/upgrade` (`specs/upgrade/*.feature`, `packages/upgrade/specs/`) |
| Code step list drift | `image-code-steps.ts --check` (above) |
| Whole upgrade on test stores | `apps/api/src/__tests__/live-upgrade.fixture.ts` (`specs/upgrade/live-test-fixtures.feature`) |
| Old image on head's schema | `.github/workflows/migration-compat.yml` (per PR, and the nightly `lts-floor` job booting the floor image) |
| A real upgrade from an old image | `dev/scripts/upgrade-rehearsal/rehearse.sh` (`upgrade-rehearsal.yml`, manual dispatch; `specs/upgrade/upgrade-rehearsal.feature`) |
| Snapshots of a seeded install | `tools/upgradelab` (`cd tools && go run ../cmd/upgradelab snapshot capture|restore|fingerprint|verify`); harness phases not landed yet, see its README |

## Never

- Migrate from an api or worker start, or wait without a deadline.
- Hand-edit a stamped manifest or a merged migration; move the floor outside `lts-release`.
- Write the ledger by hand to unstick a run: fix the cause and re-run `upgrade`, or `retryStep`.
