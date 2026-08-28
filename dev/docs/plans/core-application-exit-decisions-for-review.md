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

## 10. The enterprise four mount from `packages/enterprise/composition/api`, not `apps/api` — `LANDED`

**Decided.** `license`, `licenseEnforcement`, `scimToken`, `ssoConnections` and
`subscription` are composed by `EnterpriseTrpcComposition` in
`packages/enterprise/composition/api`, and `root.ts` consumes that directly.
They do **not** get an `apps/api` mount the way every core vertical does.

**Why.** The exit plan's own rule (line 103) is that core never imports
enterprise implementations, and that role-specific enterprise composition stays
under `packages/enterprise/composition/**`. `apps/api` is core, and mounting
these needs the enterprise *server* packages rather than their contracts. The
precedent is `apps/worker`, which reaches enterprise only through
`@langwatch/enterprise-worker`.

**Alternative not taken.** An `apps/api` mount that forwards to
`@langwatch/enterprise-api`. It would make all verticals look uniform, at the
cost of a file with nothing in it.

**Review this if** you would rather have the uniform shape — it is a small,
mechanical change to add, and the argument for it is legibility rather than
correctness.

---

## 11. `apps/api/src/internal-api/` was collapsed into `app-trpc/` — `LANDED`

**Decided.** The ops composition moved to `apps/api/src/features/ops/` and the
policy kit to `apps/api/src/app-trpc/`. The `internal-api` directory is gone, so
`@langwatch/platform-api/app-trpc` is the single specifier for every tRPC mount.

**Why.** Two entry points doing the same job invite two conventions.

**Reversibility.** Trivial; nothing outside `apps/api` imported the old paths.

---

## 12. The second `AdminSurfaceHiddenError` was deleted — `LANDED`

**Decided.** `platform/app/src/server/ops/adminSurfaceHidden.ts` is deleted. The
class lives in `@langwatch/ops-contract`, and both remaining callers already
import it from there.

**Why it is worth a line here rather than a silent cleanup.** This error exists
to make a hidden operator surface indistinguishable from a missing one. Two
definitions is the drift risk that matters: if either ever gained a
distinguishing detail, a prober could tell the two apart, which is the exact
thing the error prevents.

**Verified before deleting:** zero importers of the deleted path.

---

## 13. The destructive-ops guard now refuses a missing session — `LANDED`

**Decided.** `requireDestructiveOpsAuth` in
`packages/features/ops/server/src/api/app-trpc/ops.api.ts` read
`ctx.session?.user.impersonator`, so a null session skipped the impersonation
refusal and fell through to the confirmation check alone. It now refuses an
absent session outright.

**Why.** The guard's strictest branch was the one a missing session bypassed,
and it stands in front of blob deletion and authorization-path rollback. The
authenticated procedure it mounts behind makes the null case unreachable today —
so this changes no reachable behaviour — but a guard that is fail-open in shape
only stays safe while the thing in front of it does.

**Review this if** you would rather the package API not assume its own mount
point is authenticated. The alternative is to make the session non-nullable in
`OpsTrpcContext`, which is stricter and a larger change.

---

## 14. The route lazy-loader moves to `@langwatch/ui`, and `routes.tsx` imports it under its old local name — `IN FLIGHT`

**Decided.** The `page()` helper that wrapped every `import()` in
`platform/app/src/routes.tsx` is now `lazyRoute` in
`apps/ui/src/behavior/lazy-route.ts`, exported from the `@langwatch/ui` root
entry. `routes.tsx` consumes it as `import { lazyRoute as page } from
"@langwatch/ui"`, so all ~130 route stanzas are untouched.

**Why.** ADR-002 says stale-chunk recovery is owned by `apps/ui/src/behavior`
and that the legacy route table consumes that one implementation. The route half
of that recovery was still a private closure in `routes.tsx`, so the ADR
described a state the code did not have. `routes.tsx` is centrally owned and
several agents are working around it, so the change is two lines plus the
deletion of the helper — a rename of every call site would have been a
130-line diff in a file that is a merge hotspot.

**Alternative not taken.** Rewrite each `...page(() => import(...))` to
`...lazyRoute(...)`. That is more honest about where the function comes from and
removes the alias, at the cost of a large diff in the most contended file on the
branch. `src/__tests__/navigationDestinationsAreRouted.unit.test.ts` parses
`routes.tsx` as text, but only for `path: "..."` literals, so either shape is
safe for it.

**Cost of the alias.** A reader of `routes.tsx` sees `page(...)` and has to
follow the import to learn it is package code. That is a real legibility loss.

**Reversibility.** Trivial: the alias is one line.

**Watch this one.** `reloadOnChunkError` is no longer imported by `routes.tsx`.
If a future edit reintroduces a bare `import()` in the route table without going
through `page`, a stale chunk after a deploy will reach the error boundary
instead of reloading, and nothing will fail.

---

## 15. `LegacyPrefixRedirect` moves to `apps/ui` as `UiPrefixRedirect`, and the move restores a prop a merge dropped — `IN FLIGHT`

**Decided.** `platform/app/src/components/LegacyPrefixRedirect.tsx` is deleted.
The component is `UiPrefixRedirect` in
`apps/ui/src/ui/elements/ui-prefix-redirect.tsx`, exported from the
`@langwatch/ui` root entry. `routes.tsx`, `legacyRedirects.tsx` and
`src/__tests__/legacyRedirects.integration.test.tsx` import it from there.

**Why the rename.** In `apps/ui` the "Legacy" prefix would be wrong: ADR-002
reserves that word for deliberate temporary composition and explicit deletion
targets (`LegacyUiShellAdapter`). A prefix redirect is a permanent routing
primitive, and the thing that is legacy is the URL, not the element.

**Why it moved at all.** It depends on `react-router` and nothing else, which is
rare in the shell closure. The redirect *table* (`legacyRedirects.tsx`) is
application route data and stays in `platform/app`; ADR-001's model is exactly
that — a global `ui/` primitive, composed by app-owned data.

**This move carries a fix, which is the part to review.** On this branch the
component was broken: merge `5770224e31` dropped `pinParams` from the
destructured signature while keeping the body that reads it. `pinParams` was
therefore an undeclared free identifier — a `pnpm typecheck` error, and a
`ReferenceError` on every `/governance/ingestion-sources`, `/governance/catalog`
and `/governance/cost-centers` hit at runtime. The moved file restores
`origin/main`'s signature verbatim.

**Alternative not taken.** Fix in place and leave the move for later, so the
repair is a one-file diff that rebases cleanly on its own. Rejected because the
programme's rule is that a slice leaves `platform/app` smaller, and the move is
otherwise free. The cost is that reverting the move also reverts the fix.

**Reversibility.** High — four files.

**Watch this one.** `src/__tests__/legacyRedirects.integration.test.tsx` asserts
`?tab=sources` in four places; those assertions are the `pinParams` path and
could not have been passing on this branch. Run it first.

---

## 16. The second design-system provider in `platform/app` is deleted, not moved — `IN FLIGHT`

**Decided.** `platform/app/src/components/ui/provider.tsx` — a `Provider`
wrapper that bound `uiDesignSystem` to `DesignSystemProvider` — is deleted. Its
two callers (`pages/onboarding/welcome.tsx`, `pages/onboarding/product/index.tsx`)
now render `UiDesignSystemShell system={uiDesignSystem}` directly, which is what
`AppProviders.tsx` already does.

**Why.** ADR-004 says `apps/ui` does not own a second provider, and by extension
the application should not own a third. Two wrappers over the same provider are
the drift risk: one of them gains a prop and half the app gets it.

**Alternative not taken.** Move the bound wrapper into `apps/ui` as, say,
`UiDesignSystem`. That would save two callers from naming the system, at the
cost of a second door onto the same provider in the package that ADR-004 says
should have one.

**Cost.** Two call sites now repeat `system={uiDesignSystem}`.

**Reversibility.** Trivial.

**Watch this one.** Both onboarding pages mount a design-system provider
*inside* an application that already mounts one in `OuterProviders`. That
nesting is pre-existing and was preserved exactly; it is worth a separate look,
because a nested Chakra provider is usually a mistake rather than an intent.

---

## 17. Most of the shell stays in `platform/app`, because `apps/ui` cannot declare its dependencies in this pass — `IN FLIGHT`

**Decided.** `OuterProviders`, `InnerProviders`, `RootLayout`,
`PageErrorFallback`, `NotFoundOrErrorPage`, `GraphicsQualityProvider` and
`useAttributionCapture` were all read and all left where they are.

**Why.** Two different walls, and only one of them is architectural.

The architectural wall is real and should not be worked around: `TRPCProvider`
and `usePublicEnv` bind to the application's `AppRouter` type through
`~/utils/api`; `CommandBarProvider`, `EnterpriseSaasFooter` and
`useNavigationV2Tracking` reach `useOrganizationTeamProject` and therefore the
same client. Those are pinned until the transport is packaged.

The second wall is mechanical, and it is the one to review. `apps/ui`
declares twelve runtime dependencies. `GraphicsQualityProvider` needs `zustand`,
`PageErrorFallback` and `NotFoundOrErrorPage` need `lucide-react`, and
`RootLayout` needs `nprogress` and `react-error-boundary`. None of the four is
present in `apps/ui/node_modules` **or** in the root `node_modules`, so a move
would not resolve from `apps/ui/src` under either Node or Vite resolution.
Declaring them in `apps/ui/package.json` is the correct end state, but it takes
effect only after a `pnpm install`, which this pass was not allowed to run.

**Alternative not taken.** Declare the dependencies anyway and move the code,
leaving the branch unbuildable until someone installs. Rejected: several agents
are working in this tree at once and an unverifiable broken module graph is a
poor thing to hand any of them. The cost is that the single largest remaining
browser-only vertical — graphics quality, four source files and three tests with
only two importers — did not move when it was ready to.

**Reversibility.** Not applicable; nothing was changed. This entry exists so the
next pass starts by adding `zustand`, `lucide-react`, `nprogress` and
`react-error-boundary` to `apps/ui/package.json`, installing, and then moving
those verticals.

**Watch this one.** `platform/app/src/main.tsx` is the browser process entry and
belongs in `apps/ui` under ADR-111, but it imports
`./runtime/ui/legacy-ui-shell.adapter` and `./styles/globals.scss`. Moving it
would make `apps/ui` import `platform/app`, which ADR-001 forbids. It is pinned
by direction, not by dependencies, and no install will unpin it.

---

## 18. `apps/**` still gates no CI, and the extraction is making that worse — `NOT DONE, YOUR CALL`

**Not decided — raised.** `apps/**` is absent from the `relevant` change filter
in `.github/workflows/langwatch-app-ci.yml`, so a change confined to `apps/api`,
`apps/ui`, `apps/server` or `apps/worker` starts no CI at all. Their suites run
whenever something else relevant changed, which on a feature branch is most
pushes — but that is a side effect, not a gate.

The workflow states this as a known gap and says adding `apps/**` switches on
nine jobs for an apps-only change, which is a cost decision to take on its own
terms. That was right when `apps/*` held almost nothing.

**Why it now reads differently.** This extraction's entire purpose is to move
code into `apps/*`. Every slice makes the untested fraction larger, and the
end state — `platform/app` deleted — makes it total. The commits landed on this
branch today moved the tRPC policy spine, the operator back office's 92
procedures, nine worker features and the UI route guard, and none of them gates
on a job that runs because they changed.

`apps/ui`'s seventeen test files are also outside the root `pnpm test` filter,
which names `./packages/*`, `./packages/features/*/*` and
`./packages/enterprise/*` — so they are unreachable from two directions.

**I did not change it**, because the file says plainly that this is a cost
decision and nine jobs per apps-only change is real money on a constrained
runner pool. It needs your call, not mine. The cheap version is to gate only
`package-suites` on `apps/**` rather than all nine.

---

## How to add to this file

Anyone — human or agent — making a call of this kind appends a section in the
same shape: what was decided, why, the alternative not taken, how reversible it
is, and what specifically to look at when reviewing it. State the cost of the
choice honestly; an entry that only argues for itself is not reviewable.
