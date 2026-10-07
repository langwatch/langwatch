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
the chart's pre-roll Job runs `upgrade`, and every admitted api and worker writes presence
(15 s refresh, 60 s stale).

| Piece                                         | Lands with                                             |
| --------------------------------------------- | ------------------------------------------------------ |
| `pnpm task upgrade` (the one command)         | `mig-s3-runner`                                        |
| The chart Job running `upgrade`               | `mig-entry-points`                                     |
| New pods refusing until current, and presence | `mig-serving-gate`                                     |
| The presence table                            | `mig-ledger-widen`                                     |
| The "old writers gone" predicate              | `mig-cloud-presence` (`packages/upgrade/src/presence`) |

## The contract

1. **Run `pnpm task upgrade` from the new image, to completion, before any
   Deployment rolls.** It must be the new image: only it knows the steps the new
   build declares. A blocking step that is already `done` is skipped, so a
   redundant run is harmless.
2. **Run it once, with a deadline, and do not retry it in a loop.** A run that
   fails has a reason that a retry buries under identical failures. The chart's
   Job already has this shape: `backoffLimit: 0` and `activeDeadlineSeconds`
   (`charts/langwatch/templates/app/migrate-pre-roll-job.yaml:74-75`).
3. **Never run it on a rollback.** Rolling back to the previous image on the
   upgraded schema is what the expand and contract rules guarantee; there is no
   down migration. The chart's Job is `pre-upgrade` only, never `pre-rollback`
   (`migrate-pre-roll-job.yaml:29-36,63`). A deployer that runs hooks on every
   sync (ArgoCD and Flux map `pre-upgrade` to PreSync, `migrate-pre-roll-job.yaml:38-41`)
   must say so: whether a run from the older image is then a pure no-op is the
   runner's to prove, and is held until it is.
4. **Treat a failed run as a failed deploy.** Do not roll any Deployment. The
   old build keeps serving.
5. **Let the serving processes shut down gracefully.** A graceful stop deletes
   the process's presence row at once; a kill leaves it to lapse.
6. **Never run DDL from a serving pod, and never edit the ledger or the presence
   table by hand.** The ledger is the record `upgrade` and the serving gate read.

If the deploy applies the chart, items 1 to 4 need nothing beyond the chart's
Job, which `mig-entry-points` repoints to `upgrade`.

## What happens during a rollout

- **Old pods keep serving** on the upgraded schema: nothing they read was removed
  (ADR-155's window).
- **New pods start only when the ledger is current**: every blocking step their
  image declares is `done` or `not-needed`. Otherwise they refuse by name and stay
  not ready, which a rollout reads as a stuck rollout, not a crash loop.
- **Background steps start on the first new worker.** A step that needs every
  old writer gone waits until presence says so: every live api and worker row
  declares the step. That happens when the last old pod has stopped, however long
  the gradual release takes.
- **Tenant steps keep their pacing on enrolment** (rethink 6.8). The deploy never
  paces tenants; a gated step shows `gated` until it is enrolled.

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
long the check took. If its presence lapses, it logs that readiness answers 503;
a worker also takes no new jobs while in-flight ones finish. When a presence
write succeeds again it logs how long serving stopped, and the worker takes jobs
again.

## How long presence takes to clear

- **Graceful stop**: the row is deleted as the process shuts down, so it stops
  counting at once.
- **Crash, kill or lost node**: the row counts until it has not been refreshed
  for the stale bound, then never again. "Old writers gone" can therefore be late
  by at most that bound, never early.
- **The bound itself** (and the refresh interval below it) is held for Alex; the
  serving gate sets both when it records presence.

## After a rollback

The rolled-back image writes presence rows without the newer steps, so "old
writers gone" turns false again and any step waiting on it waits again. Blocking
steps the newer build applied stay applied and are harmless to the older one.
Contract steps wait for the LTS floor on cloud as on self-hosted (ADR-173,
decision 4), so a rollback within the supported window always finds its schema.
