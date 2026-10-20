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
the workers run the upgrade in their own process at start (the chart's pre-roll Job runs `pnpm task upgrade`, a run-once worker, when upgrades are serialised), and every admitted api and worker writes its roster entry
(15 s refresh, 10 minutes stale).

| Piece                                                                          | Lands with                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `pnpm task upgrade` (the one command)                                          | `mig-s3-runner`                                              |
| The workers, and the chart Job when upgrades are serialised, running `upgrade` | `mig-entry-points`, UIW slice 7                              |
| New pods refusing until current, and the roster                                | `mig-serving-gate`                                           |
| The serving roster table                                                       | `mig-ledger-widen`                                           |
| The "old writers gone" predicate                                               | `mig-cloud-presence` (`packages/upgrade/src/serving-roster`) |
| Writers before the roster (assertion, grace)                                   | `mig-pre-roster`; the serving gate's wiring is pending       |

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

If the deploy applies the chart with `serializeUpgrades` on, items 1 to 4 need nothing
beyond the chart's pre-roll Job, which runs `start:prepare:db`, that is `pnpm task upgrade`: it
starts the worker to run the upgrade once in its own process and exits 0, 1 or 3
(`charts/langwatch/templates/app/migrate-pre-roll-job.yaml`, Alex, 2026-10-11). Without
`serializeUpgrades` the Job does not render, and the deploy must cover items 1 to 4 itself.

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

A private ClickHouse target that fails or cannot be reached does not fail the run
either (Alex, 2026-10-11). Each ClickHouse target upgrades on its own: the shared
target and every healthy private target finish their steps and the release becomes
ready. The run waits for the failing target once, then holds it: its target rows
stay `failed` or `pending`, and Ops > Upgrades reads "Needs attention" with the
target on the Dataplanes tab. Only that target's organizations wait. Once it
answers, an admitted worker runs the upgrade again (every minute, slowing to every
five while it stays down) and the target catches up with no operator action. A
failing shared target still fails the run.

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
  then needs a manual `prisma migrate resolve`. Ahead of the deploy, add the
  column with `ADD COLUMN IF NOT EXISTS` first (an index cannot be built before its
  column exists), then run `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`, then
  check `indisvalid` in `pg_index`; drop and rebuild an invalid index. The migration
  then finds both. The `GatewayRealtimeSession` index (migration `20261006180001`)
  takes the same steps.
- **`trace_summaries` index (C03).** `MATERIALIZE INDEX` starts a mutation over
  every part at deploy. It competes with merges, and later `ALTER`s queue behind
  it. Watch `system.mutations`; if the cloud measurement says it is too heavy,
  move `MATERIALIZE` to a background step.

The cloud size measurement is an operator task, not part of this lane.

## After a rollback

The rolled-back image writes roster entries without the newer steps, so "old
writers gone" turns false again and any step waiting on it waits again. Blocking
steps the newer build applied stay applied and are harmless to the older one.
Contract steps wait until old writers are gone (`needsOldWritersGone`) on cloud as
on self-hosted, and no release is a required stop (Alex, 2026-10-11), so a rollback
always finds its schema.

**A rollback to an image before the roster** (`origin/main` or 3.20.1) writes no roster row, so
nothing sees it, and level-triggered steps would never re-run over what it wrote. Before rolling
forward again, run `pnpm task upgrade pre-roster-rollback` from the new image. It records the
rollback, so steps that need old writers gone wait again for the assertion or the grace after the
next upgrade run, and reopens every done background step so it re-runs over the rollback's writes.
It answers the ids it reopened; running it twice reopens nothing more.

**LangWatchQL after a `helm rollback`.** A rollback to an image before the non-destructive
converge (issue #8726) brings back its drop-first converge: it drops each `_pg` engine table before
recreating it, so a converge that fails while ClickHouse is still re-mounting the named collection
leaves no engine tables, and that image has no level-triggered check to repair them. After
such a rollback, check that every `_pg` table exists in the LangWatchQL database once ClickHouse
has finished rolling, and run the LangWatchQL provisioning again if one is missing. Rolling forward
to an image with the check repairs them within 5 minutes.

**What the LangWatchQL check repairs.** Every 5 minutes the worker's check creates the app-owned
objects that are missing (engine tables, views, key map, app functions, approved PostgreSQL views)
and grants the reader SELECT on an approved view that lacks it. It never compares columns, never
revokes and never creates the reader role, so a changed column or a missing role converges only on
a deploy: use Ops > Upgrades Retry. Alert on `level=error` with the message "lwql provisioning failed
creating ClickHouse objects" or "lwql provisioning failed creating PostgreSQL objects". The check runs
every 5 minutes and logs each failed statement at warn as "lwql reconvergence statement failed",
which this alert filter does not match.

## One runner at a time

Only one process runs the upgrade at once, because of the runner lease: a row lease in the
ledger schema, with a heartbeat and a TTL, that every worker takes when it runs the upgrade in its
own process, and so does the run-once worker the pre-roll Job and a manual `pnpm task upgrade`
start (`packages/upgrade/src/runner/runner-lease.ts`). LangWatchQL provisioning, which the run
starts as `pnpm task upgrade lwql-provision`, runs under that run's lease and takes none of its own. Prisma's own
advisory lock is a second guard for the schema. A runner that does not get the lease waits,
asks again every few seconds, names the holder every 30 s, and gives up after 10 minutes.

## First cutover from a release before the upgrade ledger (cloud)

### Why it is different

- The old pods run `prisma migrate deploy`, goose and their own system migrations at every
  start, under their own lock, not the upgrade lease.
- A failed `_prisma_migrations` row makes every old pod, and any rollback, crash-loop with
  P3009.
- 28 new migrations alter hot tables (ApiKey, User, Organization, VirtualKey, AuditLog,
  RoleBinding indexes) under a 2 s `lock_timeout`, without automatic retry.

Under the UPGRADE-FACE ruling (`dev/docs/ARCHITECTURE.md` §7), cloud users see only the
branded page while an upgrade blocks, so the operator signals below are the only signal.

### Checklist

1. Freeze deploys of the old line. Confirm no goose or Prisma number collides: diff
   `_prisma_migrations` and `goose_db_version` against the image. Expect only new ids and no
   failed rows.
2. Rehearse on a snapshot clone and time each step.
3. Grant on-call staff the platform-operator role (`pnpm task grant-platform-operator <email>`)
   so Ops > Upgrades and the upgrade alert email reach someone.
4. Pre-build the `AuditLog` and `GatewayRealtimeSession` indexes concurrently, as under "Long
   blocking steps". Pre-apply the hot-table `ALTER`s in a quiet window.
5. Check that the database role can `CREATE` the `<schema>_upgrade_ledger` schema, that every
   private ClickHouse target answers (one that does not is held, so only its organizations
   wait), and that the ClickHouse migration user's
   `mutations_sync` is 0, because migration 00103 runs a `MATERIALIZE INDEX` mutation.
6. On the OLD image's Deployment, for the window, set the old image's own skip switches
   (`SKIP_PRISMA_MIGRATE`, `SKIP_CLICKHOUSE_MIGRATE`, `SKIP_LWQL_PROVISION`) so restarting old
   pods do not race the upgrade. The new image ignores the first two, but its tasks job still
   reads `SKIP_LWQL_PROVISION` and would skip LangWatchQL provisioning, so set the switches on
   the old Deployment alone and keep them off the new image's job and worker.
7. Confirm `GROUP_QUEUE_ENVELOPE_WRITES_ENABLED=true` on the old line, so jobs the old api
   enqueues are readable by new workers.
8. Cut over at low traffic with no long transactions open. Keep
   `prisma migrate resolve --rolled-back <name>` ready.
9. Finish rolling api and workers inside the 30-minute pre-roster grace, then run
   `pnpm task upgrade old-writers-gone`.
10. Watch `pnpm task upgrade status`, `system.mutations` and the background steps for hours.
    Alert on `waitingOn: "a Retry"`, `phase: upgrade-wait`, and api `/readyz` down for more
    than 10 minutes.
11. Rollback: the previous image with its skip switches set, after resolving any failed
    `_prisma_migrations` row. Then run `pnpm task upgrade pre-roster-rollback` before rolling
    forward again.
