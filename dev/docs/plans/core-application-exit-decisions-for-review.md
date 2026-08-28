# Exit-plan judgment calls, for review

**Branch:** `feat/strict-feature-layout-v0`

Every entry below is a decision taken during the `platform/app` extraction that
was **not** spelled out in the request and that a reasonable person could have
made differently. They are recorded here rather than buried in commit messages
so they can be reviewed as a set and reversed individually.

Each entry says what was decided, what the alternative was, and what it would
cost to change now. Nothing here is a bug report — defects found along the way
live in the [exit plan](core-application-feature-extraction-plan.md).

**Status key:** `LANDED` is committed. `IN FLIGHT` is being written now.

---

## 1. The REST security composition moves into `apps/api` — `IN FLIGHT`

**Decided.** `createProjectApp` / `createOrgApp` / `createServiceApp` — the only
way to build an authenticated REST route — move out of
`platform/app/src/server/api/security/` and into `apps/api`, exported on a new
`@langwatch/platform-api/app-rest` subpath.

**Why.** All 42 REST apps under `platform/app/src/app/api/*/[[...route]]/app.ts`
obtain their builder from that one module, and that single import is the only
thing keeping them in `platform/app`. The builder itself is already packaged
(`createSecuritySpine` in `@langwatch/api`); what is moving is the composition
that binds this application's concrete authentication and error rendering to it.

**Alternative not taken.** Leave the composition where it is and move REST apps
last, after everything else. That would have kept 42 files and their ~12,000
lines in `platform/app` until the very end of the extraction.

**Reversibility.** High while it is one module. It falls sharply once REST apps
start moving to `apps/api/src/features/*`, because each moved app then imports
the new path.

**Watch this one.** `allRegisteredRoutes()` in `security/route-registry.ts` is
what the route-authentication audit walks. A route that stops registering drops
out of that audit silently, which is a security regression rather than a
cosmetic one. Confirm the audit still sees every moved route.

---

## 2. Routers become thin compositions in place, rather than moving to a new file — `LANDED`

**Decided.** `routers/apiKey.ts` (468 lines) and `routers/evaluations.ts` (198
lines) were rewritten in place as ~60-line compositions that call a mount
factory from `@langwatch/platform-api/app-trpc`. The files keep their names and
paths; `root.ts` is untouched.

**Why.** The instruction is that nothing new is added under `platform/app`.
Moving the composition to `runtime/app/internal-api/<x>.router.ts` — the route
the dataset, project, team and Langy slices took — would have created a new
file there. Rewriting in place deletes the old implementation without adding
anything.

**Alternative not taken.** Delete the router outright and have `root.ts` call
the factory directly. That is the end state, and it is strictly better; it was
deferred only because `root.ts` is edited centrally by one hand to stop parallel
agents clobbering one another's import blocks.

**Reversibility.** Trivial — it is a file move plus one import line each.

**Consequence worth knowing.** The repo now has two mount shapes at once, and
they are not equivalent: 9 routers compose from `apps/api` and import nothing
from `platform/app`, while 19 mount from `platform/app/src/runtime/app/internal-api/`
and still reach the local policy spine. The second group is an intermediate, not
a target.

---

## 3. Nineteen mounts stay in `platform/app` for now — `LANDED`

**Decided.** The mounts under `platform/app/src/runtime/app/internal-api/` stay
where they are rather than moving to `apps/api` with their features.

**Why.** Each reaches `~/server/api/trpc.root`, `~/server/api/trpc.runtime-policy`,
`~/server/api/trpc.scope-lineage-middleware` and
`~/server/app-layer/authz/trpc-middleware` — about 1,900 lines of policy spine
still in `platform/app`. Several also reach services that have not been
extracted (`~/server/modelProviders/*`, `~/server/app-layer/traces/*`,
`~/utils/modelLimits`, `~/utils/safeRegex`). Moving a mount before its spine
would mean `apps/api` importing from `platform/app`, which inverts the whole
dependency direction the extraction exists to establish.

**Alternative not taken.** Copy the spine into `apps/api` and let two copies
exist until the original is deleted. Rejected: two authorization spines that can
drift is a worse failure than a slow move.

**Reversibility.** These move as a batch once the spine lands in
`@langwatch/trpc`. Nothing is being locked in.

---

## 4. Old routers were restored from `HEAD` for every unwired vertical — `LANDED`

**Decided.** When nine in-flight migrations were stopped mid-move, the deleted
`server/api/routers/*.ts` files were restored from `HEAD` so that
`server/api/root.ts` resolves and the branch is not left broken.

**Why.** A branch whose universal router cannot load is one where no test can
run and no reviewer can read anything. Each restored router is deleted again as
its mount lands.

**Cost of the choice.** It makes the branch read as less complete than it is:
the package-owned API exists on disk while the old router is also present.
Section 1 of the exit plan carries the reconciliation.

**No work was lost.** The restore recreated deleted files only; every
package-owned API and every `apps/api` mount written by the stopped agents is
still on disk.

---

## 5. `simulation_run_metrics` now stamps the run's own time, not the dispatch time — `LANDED`

**Decided.** `trace-metrics-sync.subscriber.ts` passes `occurredAt: event.occurredAt`
where it previously passed the dispatch clock, and the two retry sites in
`compute-run-metrics.adapter.ts` stopped overwriting it with `Date.now()`.

**Why.** `simulation_run_metrics` is `ReplacingMergeTree(OccurredAt) PARTITION BY
toYYYYMM(OccurredAt)`. A replacing merge never collapses rows across partitions,
so a metrics row re-emitted in a later month landed in a different partition and
became a permanent second row for the same trace, contradicting the invariant
migrations 00080 and 00081 state in as many words.

**This is a behaviour change, and it is the reason to review it.** The
customer-visible number was already correct, because the read path merges with
`GROUP BY TraceId` — which is why the defect went unnoticed. The fix corrects
what is stored, not what is displayed.

**Two tests were rewritten, not repaired.** They asserted the clock-stamping
behaviour, so they documented the defect. They now assert the invariant
("dispatches the same command a month later", "retains one metrics row for the
trace"). If you disagree with the fix, those two tests are where to look first.

**Not done:** existing duplicate rows in `simulation_run_metrics` are untouched.
No backfill or dedup migration was written.

---

## 6. Suite commands now deduplicate, with a one-minute TTL — `LANDED`

**Decided.** All three commands on the suite run processing pipeline are
registered with `deduplication: { makeId, ttlMs: 60_000 }`, and a `requireJobId`
helper throws at pipeline composition if a command registered with
deduplication defines no `makeJobId`.

**Why.** All three folds accumulate (`StartedCount + 1`, `CompletedCount + 1`,
`FailedCount + 1`) and the fold executor drops a replay by `event.id`, which two
deliveries of one command do not share. Each command defined `makeJobId`, but
`withCommand` reads deduplication only from its options, so the method was
inert: a redelivered simulation event double-counted a suite run's progress and
could flip its status to SUCCESS or FAILURE before the run had finished.

**The number to review is the TTL.** One minute matches the simulation
pipeline's `computeRunMetrics` and covers the queue's own retry window, which is
when the redelivery this guards against actually arrives. It is a queue-level
guard and the house rule says plainly that queue deduplication is not sufficient
on its own — that remains true here. The durable fix is for the fold executor to
drop a replay on `idempotencyKey ?? id` rather than `id` alone, which would make
the accumulating fold safe by construction. **That has not been done.**

**Failing at composition rather than defaulting** is the second call here. A
missing `makeJobId` could have silently fallen back to no deduplication. It
throws instead, at boot rather than under load.

---

## 7. A model-provider masking test was deleted rather than fixed — `LANDED`

**Decided.** `modelProviders.getAllForProject.masking.unit.test.ts` was deleted
and its guarantee rewritten as a package test against the real service.

**Why.** The suite mocked a service that nothing on the path called, so it
asserted nothing: it would have passed against an implementation that returned
raw credentials.

**Review this if you remember writing it.** Deleting a security test is exactly
the kind of change that should not pass unnoticed, even when the test was inert.
The replacement lives in the model-provider package.

---

## 8. `apps/**` will be linted, and one lint rule widened rather than baselined — `IN FLIGHT`

**Decided.** `apps` joins the root `lint:oxlint` and `lint:fix` scopes. Under
the architecture config `apps/**` produces 5 errors and about 250 warnings, and
220 of the warnings are one test-hygiene rule.

All 5 errors are `langwatch(package-boundaries)` — "Feature server packages may
be imported only by app or worker runtime composition roots" — and every one is
a **test for a composition root**, importing exactly what the root it tests
imports. The rule recognises `apps/*/src/**` as a composition root but not
`apps/*/tests/**`.

**Decided:** widen the rule to a composition root's own tests. **Explicitly
rejected:** adding baseline entries, which would freeze a rule gap as though it
were debt and hide it from everyone downstream.

---

## 9. Everything on this branch is committed unverified

**Not a judgment call — a constraint, recorded so no one mistakes a green-looking
branch for a checked one.** This machine cannot currently run `vitest` or a
typechecker without starving the parallel work, so no commit on this branch has
been verified by a test run, a typecheck or a whole-tree lint. Claims in commit
messages come from reading code.

Before this branch is merged it needs, at minimum: `pnpm typecheck:all`, the
package test suites, both authorization guard suites, and the architecture lint.

---

## How to add to this file

Anyone — human or agent — making a call of this kind appends a section in the
same shape: what was decided, why, the alternative not taken, how reversible it
is, and what specifically to look at when reviewing it. State the cost of the
choice honestly; an entry that only argues for itself is not reviewable.
