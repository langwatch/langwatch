# Upgrade on deploy: the contract an automated deploy must meet

> **Why this exists**: cloud ships every merge as a `git-<sha>` image by gradual
> release, with no operator and no version number, and its deploy lives in a
> private repository this one cannot see. This page states what that deploy (or
> any automated deployer) must do so that old and new builds serve side by side
> safely. The decision behind it is ADR-173
> (`dev/docs/adr/173-upgrades-run-on-deploy.md`); the scenarios are
> `specs/upgrade/cloud-automatic.feature`.

## Status

The contract is fixed now; the pieces it names land in slices. All five have landed:
the workers run `upgrade` at start (the chart's pre-roll Job does too, when upgrades are serialised), and every admitted api and worker writes its roster entry
(15 s refresh, 60 s stale).

| Piece                                           | Lands with                                                   |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `pnpm task upgrade` (the one command)           | `mig-s3-runner`                                              |
| The workers, and the chart Job when upgrades are serialised, running `upgrade` | `mig-entry-points`, UIW slice 7 |
| New pods refusing until current, and the roster | `mig-serving-gate`                                           |
| The serving roster table                        | `mig-ledger-widen`                                           |
| The "old writers gone" predicate                | `mig-cloud-presence` (`packages/upgrade/src/serving-roster`) |
| Writers before the roster (assertion, grace)    | `mig-pre-roster`; the serving gate's wiring is pending       |

## The contract

1. **Run `pnpm task upgrade` from the new image, to completion, before any
   Deployment rolls.** It must be the new image: only it knows the steps the new
   build declares. A blocking step that is already `done` is skipped, so a
   redundant run is harmless. The workers also run it at their own start and
   the api is not ready until the installation is current, so the Job ahead
   of the roll is the serialised-upgrades path, not the only one.
2. **Run it once, with a deadline, and do not retry it in a loop.** A run that
   fails has a reason that a retry buries under identical failures. The chart's
   Job already has this shape: `backoffLimit: 0` and `activeDeadlineSeconds`
   (`charts/langwatch/templates/app/migrate-pre-roll-job.yaml:49-50`).
3. **Never run it on a rollback.** Rolling back to the previous image on the
   upgraded schema is what the expand and contract rules guarantee; there is no
   down migration. The chart's Job is `pre-upgrade` only, never `pre-rollback`
   (`migrate-pre-roll-job.yaml:38`). A deployer that runs hooks on every
   sync (ArgoCD and Flux map `pre-upgrade` to PreSync, `migrate-pre-roll-job.yaml:38-41`)
   must say so: whether a run from the older image is then a pure no-op is the
   runner's to prove, and is held until it is.
4. **Treat a failed run as a failed deploy.** Do not roll any Deployment. The
   old build keeps serving.
5. **Let the serving processes shut down gracefully.** A graceful stop deletes
   the process's roster entry at once; a kill leaves it to lapse.
6. **Never run DDL from a serving pod, and never edit the ledger or the serving roster
   table by hand.** The ledger is the record `upgrade` and the serving gate read.
7. **Let the `DATABASE_URL` role create the ledger schema.** `upgrade` keeps the ledger, its lease
   and the serving roster in their own Postgres schema, `<installation schema>_upgrade_ledger`
   (`public_upgrade_ledger` by default), created on its first run. A role without `CREATE` on the
   database needs that schema created for it beforehand, owned by the role.

If the deploy applies the chart, items 1 to 4 need nothing beyond the chart's
Job, which `mig-entry-points` repoints to `upgrade`.

## What happens during a rollout

- **Old pods keep serving** on the upgraded schema: nothing they read was removed
  (ADR-155's window).
- **New pods start only when the ledger is current**: every blocking step their
  image declares is `done` or `not-needed`. Otherwise they refuse by name and stay
  not ready, which a rollout reads as a stuck rollout, not a crash loop.
- **Background steps start on the first new worker.** A step that needs every
  old writer gone waits until the serving roster says so: every live api and worker row
  declares the step. That happens when the last old pod has stopped, however long
  the gradual release takes.
- **Tenant steps keep their pacing on enrolment** (rethink 6.8). The deploy never
  paces tenants; a gated step shows `gated` until it is enrolled.

## Writers from before the roster

Images before the serving roster (`origin/main`, 3.20.1) write no roster row, so the roster
cannot see them (plan 2026-10-08 F-6; Round 47 E2; ADR-173, amendment 2026-10-08). When the
ledger was seeded from an installation that already existed, a step that needs every old writer
gone also waits until one of these happens, whichever is first:

- **The assertion.** `pnpm task upgrade old-writers-gone`, run from the new image once the
  rollout has finished and the old pods have stopped. It records the assertion in the ledger
  schema and exits 0; it takes no lease and boots no module.
- **The grace.** A fixed time after the first upgrade run that finished since the seed, judged by
  the database clock.

Who asserts, by deployment:

- **Cloud's private deploy**: runs the command as the step after its rollout completes (both api
  and workers), from the image it just rolled.
- **Helm**: set `app.migrations.oldWritersGoneHook: true`. A post-upgrade Job waits for the app
  and workers rollouts, then for their termination grace, then runs the command. It needs a Role
  that reads the two Deployments and its own ServiceAccount token, projected into its kubectl
  container only, which is why it is off by default (`global.automountServiceAccountToken` stays
  `false`). A rollout that does not finish within
  `app.migrations.oldWritersGoneHookTimeoutSeconds` (1800) asserts nothing and leaves the grace;
  the Job never fails the release. Without the hook, the grace applies.
- **docker compose**: `docker compose up -d` recreates the app and the workers independently, so
  nothing knows when both are done. Rely on the grace, or once `docker compose ps` shows every
  container on the new image, run
  `docker compose run --rm app sh -c "cd /app/apps/tasks && pnpm -s task upgrade old-writers-gone"`.

The assertion releases only writers before the roster: a live roster row that does not declare
the step still holds it.

## What a failed run means

The run stopped at one step and recorded it in the ledger with its error. Blocking
steps before it stay applied: they are expand-only, so the old build tolerates
them. No pod rolled, so the old build serves exactly as before. Read the failure
with `pnpm task upgrade status` from the new image (or the region's upgrades
page, read-only), fix the cause in a new build, and deploy again: every step is
idempotent and resumes from its checkpoint.

A background step that fails does not fail a deploy, because it runs on the
worker after the rollout. It surfaces through metrics and alerts, and the step
stays `failed` in the ledger until a later build fixes it.

## Reading the console

Every line `pnpm task upgrade` writes names its `phase`, what it is waiting on
(`waitingOn`), the milliseconds so far (`elapsedMs`) and the operator's next
action (`next`). Passwords and tokens are masked. A first run opens with a
banner, says how many schema migrations and blocking steps it applies before the
api and worker serve, and closes with "first run finished in N ms". Each phase
(preflight, Postgres schema, ClickHouse schema, reconcile) logs its start and its
end with its time, and each blocking step is named before it runs. A second
runner waiting for the lease names the holder and how long it has waited, every
30 s. A failure names its code and the command or setting that fixes it. The last
line names the UI's address from `BASE_HOST` and `pnpm task upgrade status`.
Exit codes are unchanged.

An api or worker logs that it is checking the ledger, then that it serves and how
long the check took. A failing roster write is logged and retried; it never takes the
process out of service.

## How long a roster entry takes to clear

- **Graceful stop**: the row is deleted as the process shuts down, so it stops
  counting at once.
- **Crash, kill or lost node**: the row counts until it has not been refreshed
  for the stale bound, then never again. "Old writers gone" can therefore be late
  by at most that bound, never early.
- **The bound itself** is 10 minutes and the refresh interval 15 seconds; the
  serving gate sets both when it records its roster entry.

## Long blocking steps: pre-build and mutations

Two migrations are heavy on a cloud-sized table (plan items P05 and C03).

- **`AuditLog` unique index (P05).** The plain build holds a SHARE lock and blocks
  audit writes. With the 2 second `lock_timeout` it can fail below the marker and
  then needs a manual `prisma migrate resolve`. Run `CREATE UNIQUE INDEX
CONCURRENTLY IF NOT EXISTS` ahead of the deploy so the migration finds it.
- **`trace_summaries` index (C03).** `MATERIALIZE INDEX` starts a mutation over
  every part at deploy. It competes with merges, and later `ALTER`s queue behind
  it. Watch `system.mutations`; if the cloud measurement says it is too heavy,
  move `MATERIALIZE` to a background step.

The cloud size measurement is an operator task, not part of this lane.

## After a rollback

The rolled-back image writes roster entries without the newer steps, so "old
writers gone" turns false again and any step waiting on it waits again. Blocking
steps the newer build applied stay applied and are harmless to the older one.
Contract steps wait for the LTS floor on cloud as on self-hosted (ADR-173,
decision 4), so a rollback within the supported window always finds its schema.

**A rollback to an image before the roster** (`origin/main` or 3.20.1) writes no roster row, so
nothing sees it, and level-triggered steps would never re-run over what it wrote. Before rolling
forward again, run `pnpm task upgrade pre-roster-rollback` from the new image. It records the
rollback, so steps that need old writers gone wait again for the assertion or the grace after the
next upgrade run, and reopens every done background step so it re-runs over the rollback's writes.
It answers the ids it reopened; running it twice reopens nothing more.
