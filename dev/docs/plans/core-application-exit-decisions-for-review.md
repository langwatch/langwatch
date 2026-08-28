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

## The gateway vertical's nine tRPC routers: split across three packages, with a named port seam

**What I decided.** The nine routers named as "the gateway vertical" did not all
belong to one feature, so they did not all go to one package.

- Six went to `@langwatch/gateway-server`
  (`packages/features/gateway/server/src/api/app-trpc/`): `virtualKeys`,
  `gatewayUsage`, `gatewayBudgets`, `gatewayCacheRules`, `gatewayGuardrails`,
  `gatewaySpendEvents`. Their mount is
  `apps/api/src/features/gateway/gateway-trpc.mount.ts`.
- Two went to `@langwatch/enterprise-governance-server`: `routingPolicies` and
  `personalVirtualKeys`. Every procedure in them answers from
  `app.governance.*`, and the errors they translate are
  `@langwatch/enterprise-governance-contract`'s.
- One went to `@langwatch/enterprise-webhook-server`: `webhookEndpoints`.

**Why webhookEndpoints is not gateway.** The only thing tying it to the gateway
is that the composition root parks the endpoint and health capabilities under
`deps.gateway.*`. Its service, its views, its delivery controls and all four of
its refusals are the webhook feature's, and none of them mentions a virtual key
or a budget. `packages/enterprise/features/webhook/` already existed with a
contract and a server. The transport's context type still names
`app.gateway.webhookEndpoints`, because that is the process's shape and this
slice is a transport move, not a rearrangement of the composition root.

**Why the two enterprise surfaces are not in `apps/api`.** No package under
`packages/features/**` depends on any `@langwatch/enterprise-*` package, and
`packages/enterprise/composition/api` says in its own header why: a core package
may not depend on an Enterprise one. `apps/api` has no Enterprise dependency
either. So their composition went beside its sibling, as
`EnterpriseGatewayTrpcComposition` in a NEW file
(`packages/enterprise/composition/api/src/trpc/enterprise-gateway-trpc.composition.ts`)
rather than as more branches inside `EnterpriseTrpcComposition`, which another
agent is editing right now.

**The alternative I did not take** was to put all nine in
`@langwatch/gateway-server` and add `@langwatch/enterprise-governance-contract`
and `@langwatch/enterprise-webhook-*` to its dependencies. That keeps the
vertical in one place and reads better in the plan, and it inverts the
OSS/Enterprise boundary in a package the OSS build ships. I judged the boundary
worth more than the tidiness.

**The cost, stated plainly.** "The gateway vertical" is now three packages and
two mounts. Someone looking for `routingPolicy.list` will not find it under
`features/gateway`. If the OSS/Enterprise split is ever relaxed, this should be
collapsed back into one package and one mount.

**Reversibility.** High. Each API file is self-contained; moving one between
packages is a file move plus an index line plus a mount line.

**What to look at when reviewing.** Whether `routingPolicies` really is
governance rather than gateway — it is named after a gateway concept and lives
on a gateway settings screen, and I put it with the service that answers it.

---

## The `virtualKeys` transport moved on top of a fifteen-entry port bag

**What I decided.** I moved `virtualKeys.ts` (609 lines) even though everything
it delegates to still lives in `platform/app/src/server/gateway/**` — about
2,200 lines across `virtualKey.authz.ts`, `virtualKey.dto.ts`,
`virtualKey.service.ts`, `applicableBudgets.service.ts` and
`virtualKeyDirectBudget.service.ts`. Each one arrives as a named entry in
`VirtualKeyTrpcPorts`, wired in `root.ts`.

**Why.** The transport IS movable: procedure names, input schemas, the
credential contract, the visibility-versus-permission split and the access
declarations are all now package-owned and reviewable in one file. The domain
code underneath is a separate slice, and `virtualKey.authz.ts` in particular
cannot move until `server/app-layer/permissions/imperative.ts` and
`server/rbac/role-binding-resolver.ts` do.

**The cost, stated plainly.** Fifteen ports is a lot, and every one of them is a
function that used to be a plain import. `root.ts` grows by roughly ninety lines
of wiring while `platform/app` loses 609, so the net is good but the seam is
ugly and it is now frozen into a package's exported type. Two ports are
especially unlovely: `schemas.virtualKeyBudgetInput` passes a Zod schema through
a port (taken rather than restated, because its decimal regex and
positive-amount refinement are the write path's contract and a second copy would
drift), and `principal` is typed `unknown` because a session belongs to the
process's authentication, not to this feature.

**The alternative I did not take** was to leave `virtualKeys` behind until
`server/gateway/**` moves. That would have kept the seam clean and left the
headline surface of the vertical in the tree this programme exists to delete.

**Reversibility.** High but noisy: reverting means restoring one file and
deleting the ports bag.

**What to look at when reviewing.** Whether the ports bag reads as a to-do list
for the next slice (intended) or as a permanent abstraction (not intended). Also
`toVirtualKeyDtos`, which collapses the always-paired
`loadTraceDestinationFacts` + `toVirtualKeyCamelDto` into one call — the only
place I combined two existing functions rather than fronting each.

---

## Resolver-authorized procedures declare their real permissions instead of `enforces`

**What I decided.** Eleven procedures used
`.use(authorizeInResolver({ organizationId: "<what the resolver does>" }))`,
which declares `{ kind: "service-authorized", permissions: [], enforces: {...} }`.
In the package they declare
`{ kind: "service-authorized", reason, permissions: [<the real ones>] }` — no
`enforces`.

**Why.** `enforces` cannot cross the package seam. The builder the process
exposes is `@langwatch/trpc`'s `serviceAuthorized({ reason, permissions })`,
which does not accept `enforces`, and `packages/trpc/**` belongs to another
agent this session. The sweep
(`platform/app/src/server/api/__tests__/authz-declaration-sweep.unit.test.ts`)
covers a `service-authorized` declaration's required scope fields from EITHER
`enforces` OR the grant tiers of its declared permissions; every one of these
inputs requires `organizationId` and every permission named is grantable at the
organization tier, so coverage holds either way.

**Why it is arguably better.** `permissions: []` recorded nothing about what the
resolver enforces. Naming `virtualKeys:manage`, `virtualKeys:update`,
`virtualKeys:rotate`, `virtualKeys:delete` and `virtualKeys:viewOtherPersonal`
records it, and that is what `.authorizeInService()` exists to say.

**The cost, stated plainly.** The declaration text changed on eleven
procedures, so a reviewer diffing declarations sees churn that is not a
behaviour change. Runtime behaviour is identical: both kinds mark the request
checked and run nothing else.

**The alternative I did not take** was to add `enforces` pass-through to
`packages/trpc/src/trpc-declared-authz.ts` and
`apps/api/src/app-trpc/app-trpc.declared-check.ts`. That is the faithful
preservation, and it edits a file another agent owns.

**Reversibility.** High, once `packages/trpc` is free: add `enforces` to the
builder and swap the declarations back.

**What to look at when reviewing.** That every one of the eleven still passes
the sweep — I could not run it (see the report), and a permission whose grant
tiers exclude `organization` would silently stop covering `organizationId`.

---

## I added `appTrpcServiceAuthorizedPolicy` to the shared apps/api policy module

**What I decided.** `apps/api/src/app-trpc/app-trpc.policy.ts` exported three of
the four declaration kinds (`permission`, `permission-any`, `no-permission`).
I appended the fourth, `service-authorized`, and exported it from
`apps/api/src/app-trpc/index.ts`.

**Why.** Without it a package-owned transport cannot express
`.authorizeInService()`, which eleven of these procedures need. The existing
`declaredCheckFrom` already maps the kind; only the caller-facing helper was
missing.

**The cost, stated plainly.** It is an edit to a file several agents are
touching this session. It is purely additive (a new export at the end), so the
worst case is a merge conflict rather than a behaviour change.

**Reversibility.** Trivial.

**What to look at when reviewing.** That it did not land twice after a merge.

---

## Three router tests moved to their packages; two of them narrowed

**What I decided.** `gatewaySpendEvents.unit.test.ts`,
`gatewayBudgets.perPerson.unit.test.ts` and `webhookEndpoints.unit.test.ts` moved
into their packages, keeping every `@scenario` annotation so feature parity stays
bound. Two changed shape.

- The webhook test still drives the REAL endpoint service over a stubbed Prisma
  client and an identity cipher, so the secret-once contract is unchanged. Only
  the RBAC assertions changed: they now stand on the policy the process hands
  in, asserting that the handler never runs when the policy refuses.
- The budgets test NARROWED. The version in `platform/app` drove
  `GatewayService` and its Prisma repository through a mocked client and asserted
  the per-person standing arithmetic; the package version stands in for the
  budget-decision service and asserts only that the standing and the scope-target
  name reach the wire.

**Why the budgets one narrowed.** Reproducing the old test meant constructing a
real `GatewayService` over a mocked Prisma client, and `GatewayService.create`'s
signature changed under me this session (another agent folded cache rules and
guardrails into it). Writing that blind, with no ability to run tests, was the
worse risk.

**The cost, stated plainly.** Coverage of the seat-standing arithmetic THROUGH
the router is gone. It is still covered directly by
`packages/features/gateway/server/tests/gateway-budget-dto.unit.test.ts` and
`platform/app/src/server/gateway/__tests__/budgetSeatStandings.unit.test.ts`, so
no scenario is unbound — but a regression in how `listWithHealth` assembles the
standing would now fail one file rather than two.

**Reversibility.** Medium. Restoring the wide version means writing the
`GatewayService` fixture against whatever signature settles.

**What to look at when reviewing.** Whether the narrowed budgets test is worth
keeping at all, or whether the DTO test already says everything it says.

---

## Small substitutions I made rather than porting a `platform/app` import

Three imports had exact equivalents already inside the packages, so I used those
instead of adding a port. All three are same-values swaps; I list them because
each is a place a reviewer would otherwise wonder why the code differs.

- `WEBHOOK_DESTINATION_KINDS` from `~/utils/webhookDestinations` became
  `webhookDestinationKindSchema` from `@langwatch/enterprise-webhook-contract`.
  Both are `["http", "sqs"]`.
- `z.nativeEnum(RoutingPolicyScopeType)` from the generated Prisma client became
  `routingPolicyScopeTypeSchema` from the governance contract. Both are
  `["ORGANIZATION", "TEAM", "PROJECT"]`. I deliberately did NOT adopt the
  contract's `routingPolicyScopeEntrySchema`, which is `.strict()` and requires a
  non-empty `scopeId`: that would tighten validation, which is a behaviour
  change.
- `MODEL_TIERS` from `~/utils/modelTierPresets` became a local
  `z.enum(["complex", "reasoning", "fast"])` annotated as
  `z.ZodType<SuggestTierTargetsInput["tier"]>`, so a tier added to the suggester
  is a compile error here rather than a value this surface silently refuses.
- `scopeAssignmentSchema` from `~/server/scopes/scope.types` became a local
  schema in the gateway package annotated as
  `z.ZodType<GatewayVirtualKeyScope>`. Same three tiers, same `min(1)`.

**The cost.** Four values now have a second definition site, each pinned to a
shared type rather than to the original schema. If a fifth scope tier is ever
added, three of these four fail to compile and one (the webhook kinds) does not.

**What to look at when reviewing.** Whether the type annotations really would
catch drift, particularly `z.ZodType<GatewayVirtualKeyScope>`.

---

## Two things I found broken and did not fix

Both predate this slice and are reported rather than repaired, because repairing
them means guessing at another agent's in-flight work.

1. `gatewayBudgets.ts` called `ctx.app.gateway.budgetDecisions.getDetail(...)`,
   which does not exist on this branch: `GatewayService` and its contract both
   name it `tryGetDetail`, and `origin/main`'s router still says `getDetail`. So
   a rename landed here without updating the caller. The package version calls
   `tryGetDetail`; its `if (!detail) throw NOT_FOUND` was already exactly
   `tryGetDetail`'s contract, so nothing else changed.
2. `packages/eventing/adrs/20260828-production-server-adapters.md` names
   `platform/app/src/server/api/routers/webhookEndpoints.ts`, which this slice
   deletes. It is another agent's file, dated today; I left it alone.

---

## The trace vertical: which trace types moved into the contract, and which did not

`traces.*`, `spans.*` and `traceEditOverlay.*` became package-owned. A tRPC
handler's return type IS the client's type, and inside a generic
`create<TContext extends …>` TypeScript resolves a property access against the
CONSTRAINT, not against the concrete context the mount later supplies. So the
package cannot leave the legacy read service's result types unnamed: whatever
the constraint says is what every caller of `api.traces.*` sees.

I moved six result types out of `platform/app/src/server/traces/types.ts` into
`@langwatch/trace-contract` (`trace-read.contract.ts`): `TraceWithGuardrail`,
`TracesForProjectResult`, `TopicCountsResult`, `CustomersAndLabelsResult`,
`DistinctFieldNamesResult` and `PromptStudioSpanResult`. Every one of them is
built only from types already in that package. I left the three INPUT types
behind — `GetAllTracesForProjectInput`, `AggregationFiltersInput` and
`GetAllTracesForProjectOptions` — because they are derived from
`sharedFiltersInputSchema` and `ProjectionPlan`, neither of which has left the
application, and dragging those out is a filter-vertical slice rather than a
transport one.

**The alternative I did not take** was to keep every result type where it was
and declare the port with `unknown` returns. That compiles and moves the same
files, and it silently turns `api.traces.getAllForProject` into `unknown` for
every caller in the UI. A second alternative — a generic parameter per result
type — does not work: TypeScript resolves the handler body against the
constraint, so the generic would never be reached.

**The cost.** `platform/app/src/server/traces/types.ts` is now split across two
homes, and a reader of `TraceService` has to look in two places for the shapes
it deals in. Eight files were repointed (`clickhouse-trace.service.ts`,
`trace.service.ts`, `parseLLMSpanMessages.ts`, two export tests, three
ClickHouse pagination tests).

**Reversibility.** High. The six types moved verbatim; moving them back is a
copy and eight import lines.

**What to look at when reviewing.** Whether the split is the right seam, or
whether the whole of `traces/types.ts` should follow once the filter schema
moves.

---

## The trace-correction patch schema moved into the contract rather than becoming a port

`traceEditOverlay.upsert` parses its patch with `traceEditOverlayPatchSchema`.
The package is supposed to own its input schemas, but that schema lived in
`platform/app/src/server/traces/edit-overlay/traceEditOverlay.schemas.ts`, which
19 other files import — 15 of them browser code importing a `~/server/…` path
for a type.

I moved the whole module into `@langwatch/trace-contract` as
`trace-edit-overlay.contract.ts`, and put `TraceEditOverlayAuthor` (from the
repository) and `TraceEditOverlayDto` (from the service) in it as well, since
the transport's return type is that DTO. Its unit test moved with it, to
`packages/features/trace/contract/tests/trace-edit-overlay.contract.unit.test.ts`.
The module depended on nothing but `zod` and `@langwatch/trace-contract`, so
nothing had to be broken up to move it, and seven now-stale entries came out of
`legacy-application-boundary-baseline.json`.

**The alternative I did not take** was injecting the schema as a port the way
the analytics filters are injected. That is one line instead of 21 repointed
imports, and it would have left a contract-shaped module inside the application
and 15 browser files still importing server code.

**The cost.** 21 files changed for a transport slice, several of them in
`features/traces-v2/`, which other agents may be editing. Every change is a
one-line import specifier, so a clobber loses a rename rather than corrupting
logic — but it is still churn outside the vertical's transport.

**Reversibility.** High; the file moved verbatim.

**What to look at when reviewing.** That the DTO and the author interface belong
in a `.contract.ts` rather than staying a server detail — a correction's
`createdBy` is a `User` projection, so it is arguably identity's shape, not
trace's.

---

## `protections` is `unknown` in the trace read port, and a named field in the overlay one

Every legacy trace read takes the viewer's read-time redactions. `Protections`
lives in `platform/app/src/server/traces/protections.ts` and 48 files import it.

`spans.*` and `traces.*` never look inside the value — they ask the process for
it and hand it straight to the read — so their port declares it `unknown`. That
is accurate rather than lazy: a second declaration of a 40-line type would be
duplication, and TypeScript's bivariant method parameters let the real
`Protections` satisfy it.

`traceEditOverlay.*` DOES read one field (`visibilityCutoffMs`, to decide
whether the plan's window teases the trace), so its port is generic over
`TProtections extends { visibilityCutoffMs?: number | null }`, inferred from the
process's own function. Nothing else about the shape is restated.

**The alternative I did not take** was moving `Protections` into a contract
package. It is the right end state — it would let the read port be honest and
would unblock several other verticals — but it is 48 files, in a tree several
agents are editing, for a slice whose subject is the transport.

**The cost.** Two different treatments of the same value in three sibling files,
and a reader has to notice why. A future move of `Protections` will want to
replace both.

**What to look at when reviewing.** Whether `unknown` here reads as a gap. If it
does, the fix is the 48-file move, not a duplicated type.

---

## Extended inputs are chained `.input()` calls, not `.extend()` or `z.intersection`

Three procedures took the shared filter schema plus a few extra keys
(`getSampleTraces`, `getSampleTracesDataset`, `getAllForDownload`). The router
wrote that as `tracesFilterInput.extend({ … })`. The package does not hold that
schema — it arrives as a port — so `.extend()` is not available on a
`z.ZodType`.

The obvious replacement is `z.intersection`, which is what
`analytics.api.ts` already does for `dataForFilter`. I did not use it:
`authz-declaration-sweep.unit.test.ts` reads each procedure's input schema to
find the scope ids it accepts, and a `ZodIntersection` exposes no `shape`, so it
is reported as an input the sweep cannot inspect — a guard failure, not a silent
pass. I verified this against the installed zod 4.4.3.

So each of the three chains a second `.input()` carrying only the keys the
process's schema does not already have. tRPC keeps both parsers on the
procedure (each still a readable object), runs both against the raw payload, and
spreads the results — I read `createInputMiddleware` and `createNewBuilder` in
`@trpc/server` 11.18.0 to confirm. The router's `.extend({ projectId, query })`
re-declared two keys the base schema already had, so those are dropped rather
than duplicated; re-declaring them in the second parser would make both parsers
emit the same key.

**The cost.** The extra keys are now in a separate schema object from the ones
they conceptually extend, which reads slightly oddly. And the input is validated
by two passes rather than one.

**Reversibility.** High.

**What to look at when reviewing.** That the dropped `projectId`/`query`
re-declarations really were identical to the base schema's — they are, in
`traces.schemas.ts` and `analytics/types.ts`.

---

## A six-line Fisher–Yates instead of adding `lodash-es` to the package

`getSampleTraces` used `shuffle` from `lodash-es`. `@langwatch/trace-server` does
not depend on it, the repo does not hoist it, and I could not run
`pnpm install` to add it, so a new dependency would have been declared but
unresolvable until someone installed.

I wrote `shuffled()` in `traces.api.ts` instead: a copy plus Fisher–Yates, which
is what lodash's `shuffle` does, on `Math.random`, which is what lodash uses.

**The cost.** A utility with a second implementation in the repo. If the sampling
ever needs a seeded shuffle, this is one more site to change.

**Reversibility.** High — add the dependency and delete six lines.

**What to look at when reviewing.** Whether adding `lodash-es` to
`packages/features/trace/server` is preferred; if so it is a one-line
`package.json` change plus an install.

---

## The injected filter schemas carry the SENT shape as well as the parsed one

`analytics.api.ts` declares its injected schemas as `z.ZodType<TReadInput>`. In
zod 4 that is `ZodType<TReadInput, unknown>`, and tRPC types the CLIENT off a
parser's input type — so every caller of those procedures passes `unknown` and
is unchecked. `traces.getAllForProject` is called from a lot of UI, so I took
the second type parameter as well: `z.ZodType<TFilterInput, TFilterInputRaw>`,
with the raw shape inferred from whatever the process hands over.

**The cost.** Two more type parameters on `TracesTrpcApi.create` (eight in
total), which is a lot of machinery on one signature. If inference ever fails
the parameter degrades to `unknown`, i.e. back to the analytics behaviour, so
the failure mode is not worse than the status quo.

**What to look at when reviewing.** Whether analytics should get the same
treatment — as it stands, four analytics reads accept anything from the client.

---

## Where I stopped: `sharedTrace` and `tracesV2` did not move

I did `spans` → `traceEditOverlay` → `traces` and stopped, deliberately.

`sharedTrace.ts` imports four mappers (`mapTraceSummaryToHeader`,
`deriveTraceDropPrivacy`, `mapSpansToDetailDtos`, `redactV2Content`) out of
`tracesV2.ts`, plus `tracesV2.gates.ts`, `tracesV2.resourceAttrs.ts` and
`trace-tree.legacy.mapper.ts`. A package cannot import a router that stays in
`platform/app`, so `sharedTrace` cannot move before `tracesV2` does — the
prescribed order has them the other way round, and that ordering does not hold
once the imports are read.

`tracesV2.ts` is 2,192 lines, 27 procedures, and roughly 1,000 lines of exported
mapper and redaction helpers that six other modules import. It depends on
fifteen application modules that have not moved (`data-privacy/*`,
`traces/mappers/redaction`, `traces/mappers/redactAttributes`,
`tracer/spanIOStringify`, `traces/findPromptReferenceInAncestors`,
`app-layer/traces/claude-code-log-enrichment`, `app-layer/traces/ai-query`,
`app-layer/traces/model-cost-span-preview.service`,
`app-layer/traces/trace-metadata.service`, `shared/traces/media-refs`, …). It is
a slice of its own, and doing it in the tail of this one would have produced
exactly the rushed result the brief warned against.

**What to look at when reviewing.** Whether the next slice should be the
redaction/mapper layer (`tracesV2`'s helpers plus `Protections`) rather than the
transport — the transport is the easy half once those move.

---

## The worker's liveness and metrics server moved to `apps/worker`

`platform/app/src/server/workers/startWorkers.ts` was 584 lines, of which ~330
were the metrics/liveness HTTP server: `LIVENESS_THREAD_SOURCE`, the
`worker_threads` server that binds the metrics port and answers `/healthz`, the
bearer gate plumbing, the fallback in-loop server and the thread proxy. That
block is process concern, not application logic, so it moved to
`apps/worker/src/platform/liveness/worker-metrics.server.ts`. `startWorkers.ts`
is now 301 lines and its metrics stage is a 21-line adapter.

```
BEFORE                                   AFTER
platform/app/.../startWorkers.ts         apps/worker/.../worker-metrics.server.ts
  WORKER_LIVENESS_PATH ......(dup)         (imports WORKER_LIVENESS_PATH)
  LIVENESS_THREAD_SOURCE                   LIVENESS_THREAD_SOURCE
  createWorkerMetricsHandler               createWorkerMetricsHandler
  bootMetricsServer                        startWorkerMetricsServer
    -> getWorkerMetricsPort()                <- port           (port)
    -> isMetricsAuthorized()                 <- isAuthorized   (port)
    -> prom-client register                  <- readMetrics    (port)

apps/worker/.../worker.liveness.ts       apps/worker/.../worker.liveness.ts
  WORKER_LIVENESS_PATH ......(dup)         WORKER_LIVENESS_PATH   (the one copy)
  isWorkerHeartbeatLive .....(dead)        WORKER_HEARTBEAT_STALL_BUDGET_MS
  createWorkerLivenessPolicy (dead)
```

**The cost.** The Kubernetes liveness path for the production worker fleet now
crosses a package boundary. A resolution failure of
`@langwatch/worker/liveness/server` is a boot failure of the standalone worker,
where before it was a local import that could not fail on its own.

**Reversibility.** High — the module is self-contained and has no importer other
than `startWorkers.ts`.

**What to look at when reviewing.** That the probe contract is byte-identical:
path `/healthz`, port `getWorkerMetricsPort()` (2999 by default, what the chart
probes), 200 `text/plain` `ok` when the heartbeat is fresh, 503 `text/plain`
`main loop stalled Ns` past the budget, and `/metrics` still 401 / 500 / 200 with
the registry's own content type.

---

## `prom-client` is a port, not an import, and the moved handler test lost its real registry

`register` is a process-global singleton. If `apps/worker` and `platform/app`
ever resolved two copies of `prom-client`, the endpoint would serve an EMPTY
registry rather than fail — a total, silent loss of worker metrics. So the
server takes `readMetrics(): Promise<{ body, contentType }>` and the host reads
its own registry.

The consequence is in the test. `workerMetricsHandler.unit.test.ts` registered a
real `Counter` and asserted the rendered body contained it, against
`register.contentType`. The moved test
(`apps/worker/tests/worker-metrics.server.unit.test.ts`) asserts that whatever
`readMetrics` returns is passed through untouched, body and content type both.
That is the right assertion for the handler, and it is strictly less than the
old one: nothing now proves `register.metrics()` is what actually gets called,
because that wiring lives in `startWorkers.ts`'s adapter and has no test.

**The alternative not taken.** Add `prom-client` to `apps/worker` and keep the
test as it was. Rejected: the duplicate-singleton failure is invisible in
production and the test would not catch it either, since a test process resolves
one copy.

**The cost.** A four-line adapter in `startWorkers.ts` is untested. If someone
changes it to return an empty body, or drops `contentType`, every unit test
stays green and Prometheus stops parsing the worker registry. The chart e2e
(`Worker /metrics serves samples to an authenticated scrape`) is the only guard
left on it, and it runs only in the chart e2e workflow.

**What to look at when reviewing.** Whether that adapter deserves a test in
`platform/app/src/server/__tests__/metrics.unit.test.ts` (an existing file — this
programme forbids creating new files under `platform/app`, which is why I did not
add one).

---

## The auth port is narrowed to the header the gate reads

`isMetricsAuthorized` takes a full `IncomingMessage` but reads exactly
`req.headers.authorization`. The old code already knew this: it passed
`Pick<IncomingMessage, "headers">` internally and cast back with `as
IncomingMessage`. The port declares the narrow shape
(`{ headers: { authorization?: string } }`), so the cast moved to the call site
in `startWorkers.ts`, where the real `IncomingMessage` is.

**The cost.** The cast still exists; it is one line in `platform/app` rather than
one line in the package. It stops being safe the moment `isMetricsAuthorized`
reads a second property of the request — it would then read `undefined` on the
thread-proxy path, which is exactly the fail-open shape a bearer gate must not
have.

**What to look at when reviewing.** Whether the gate should be re-typed to take
`{ authorization?: string }` outright, deleting the cast. That is a change to
`~/server/metrics`, which also serves the web process's `/metrics`, so it was
out of this slice's scope.

---

## `isWorkerHeartbeatLive` was deleted, not wired up

`apps/worker/src/platform/liveness/worker.liveness.ts` exported a zod-validated
policy and a predicate that no production code called. The liveness thread does
its own `stalledMs > stallBudgetMs` comparison inline, because it is a string
evaluated by `new Worker(src, { eval: true })` and can import nothing.

The convergence asked for is "one liveness predicate, used by the thing that
actually serves the probe". The thread's inline comparison IS that thing, so I
deleted the parallel TypeScript one (`isWorkerHeartbeatLive`,
`createWorkerLivenessPolicy`, `WorkerLivenessPolicy`) along with
`apps/worker/tests/worker.liveness.unit.test.ts`, whose four tests covered three
deleted symbols and one constant. `worker.liveness.ts` now holds the liveness
POLICY — the path and the stall budget — and the mechanism lives next door.

**The alternative not taken.** Generate the thread source from the predicate's
`Function.prototype.toString()`, so there is literally one definition. Rejected:
it makes the production liveness path depend on how a bundler treats a function
body, and the blast radius of getting that wrong is the whole worker fleet
crash-looping.

**The second alternative not taken.** Keep `createWorkerLivenessPolicy` alive by
letting `startWorkerMetricsServer` accept a configurable `stallBudgetMs`.
Rejected: nobody asked for a configurable budget, and adding a knob to keep a
validator employed is backwards.

**The cost.** The budget is applied by a comparison inside a template literal, so
no type checker reads it. The moved thread test
(`worker-metrics.liveness-thread.unit.test.ts`) executes it on both sides of the
boundary, which is the only guard.

**Reversibility.** High — the deleted code is three exports in git history.

**What to look at when reviewing.** That deleting a package export subpath's
symbols is acceptable: `@langwatch/worker/liveness` had no importers other than
the package's own index, so nothing outside broke.

---

## `check-feature-parity.ts` gained `apps` as a test root

This is an edit to a shared `platform/app` file, made because the move needed it.

`DEFAULT_TEST_ROOTS` lists `platform/app/src`, `packages`, `sdks`, `mcp` and
others — not `apps`. `specs/server/worker-liveness-probe.feature` has ten
`@unit` scenarios bound by the two tests I moved. Moving them to
`apps/worker/tests/` would have taken all ten out of the scanner's sight, and
the spec would have reported them unbound while the tests carried on passing —
the feature-parity failure mode where a spec reads as "never enforced" because
the code left the room.

Four files under `apps/` already carry `@scenario` annotations (`apps/api/tests`,
`apps/ui/tests`, `apps/server/test`), so this was already true for other slices
of this programme; my move is only the first that would have made it visible.

**The cost.** One more root to walk (node_modules is excluded), and an edit to a
file another agent in this wave may also be editing. The checker has no
orphan-binding check, so extra bindings cannot fail anything.

**What to look at when reviewing.** Whether the parity report's totals move in a
way you did not expect — scenarios already bound from `apps/` will now count as
bound where they previously counted as unbound.

---

## Two lint carry-overs handled at the source

`.oxlintrc.architecture.json` suppressed `no-return-assign` for
`platform/app/src/server/workers/__tests__/livenessThread.unit.test.ts`, for one
line: `res.on("data", (c) => (body += c.toString()))`. The config's own comment
says "Fix a file, delete its line", so the moved test uses a block body and the
now-dangling path is deleted from the override.

**The cost.** An edit to `.oxlintrc.architecture.json`, which is already modified
in this working tree by another slice. It is a single-line deletion, so a
conflict would be visible rather than silent.

---

## What I did NOT verify

Nothing was run: no `tsc`, no `vitest`, no lint, no chart render. The machine had
no capacity and the instruction was explicit. Everything above is reasoned from
the code.

A reviewer must run, before this is deployed:

1. `pnpm --filter @langwatch/worker typecheck` and `pnpm --filter
   @langwatch/worker test:unit` — the new module and its two moved tests.
   `apps/worker/tsconfig.json` sets `"types": []` and the package declares no
   `@types/node`; the new file needs `node:http` and `node:worker_threads` the
   same way `worker-stored-object-storage.adapter.ts` already needs `node:fs`,
   so it either already works or was already broken, but I could not confirm
   which.
2. `pnpm typecheck` for `platform/app` — `startWorkers.ts` now imports a package
   subpath (`@langwatch/worker/liveness/server`) that pnpm must resolve.
3. `pnpm test:unit run src/server/__tests__/frontend-boundary.unit.test.ts` —
   that guard walks the real import graph out of `src/server/**` and now has a
   new package subpath edge to resolve.
4. `bash charts/langwatch/tests/e2e.sh` (or its CI workflow) — the only end-to-end
   proof that the kubelet still gets 200 on `/healthz` and a scraper still gets
   samples on `/metrics`. This is the one that matters: a mistake here is a
   crash-looping worker fleet on the next deploy, not a red test.
5. `WORKERS_IN_PROCESS=1 pnpm dev` — the in-process path calls `startWorkers({
   shouldStartMetricsServer: false })`, so it never reaches the moved code, but
   the new top-level import is evaluated before `setEnvironment()` and must stay
   side-effect-free (it imports two node built-ins, a type, and two constants).

---

## How to add to this file

Anyone — human or agent — making a call of this kind appends a section in the
same shape: what was decided, why, the alternative not taken, how reversible it
is, and what specifically to look at when reviewing it. State the cost of the
choice honestly; an entry that only argues for itself is not reviewable.
