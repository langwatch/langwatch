# Open decisions — 2026-09-03

Everything on `feat/strict-feature-layout-v0` that is waiting on Alex rather
than on an agent. Each item states the two or three concrete options and marks
a recommendation. Verified against the working tree on 2026-09-03; the lane
document each belongs to is named so the context is one hop away.

---

## 1. Architecture-lint R7: add a `rules/<subject>.rules.ts` layout kind

**Resolved 2026-09-04: (a), as recommended.** Implemented in
`packages/architecture-lint/src/feature-layout.ts`; see the R7 entry under
"Landed" in `architecture-lint-burn-down-plan.md`.

About 100 of the 303 `feature-source-layout` violations are pure functions with
no home — 55 `*.rules.ts`, 16 `canonicalisation/*.canonicaliser.ts`, identity's
`*-guards.ts` and `*-id.ts`, analytics' `query-builders/*` and
`clickhouse/*translator.ts`. The grammar today says a pure helper is a
`.service.ts` class, which is the Java shape; the standing preference is that
the TypeScript should read like clean Go, a package of functions.
`packages/architecture-lint/src/feature-layout.ts` has no `rules/` pattern
today, so nothing is half-built either way. **(a) Add exactly one kind,
`rules/<subject>.rules.ts`,** enforced as: the file exports functions and
constants only (no class, no `new`), and its imports resolve only to
`*-contract` packages, other `rules/` files in the same package, `node:*` and
framework-free workspace packages the portable oracle already accepts; a
`rules/` file importing a service, port, adapter, Prisma or ClickHouse fails
with a message naming the import. **(b) Refuse, and fold each `.rules.ts` into
the service that calls it** as private methods, or a `<subject>.service.ts` of
static methods — the same 100 files, a different destination; the slice list
(L2a–c) does not change either way. **Recommended: (a).** It is one new kind
with a tight, mechanically-checkable constraint, and it stops the burn-down
manufacturing 100 single-method classes whose only reason to exist is a
filename rule. Lane: `architecture-lint-burn-down-plan.md`.

## 2. Architecture-lint R8: an expiring boundary-edge baseline

**Resolved 2026-09-04: (a), as recommended, bootstrapped now rather than after
W1–W3.** `packages/architecture-lint/src/boundary-edge-baseline.{ts,json}`;
see the R8 entry under "Landed" in `architecture-lint-burn-down-plan.md`. The
bootstrap seeded from the corpus as it stood today (159 edges, all under
`packages/features/*`/`packages/enterprise/features/*`), which does include
some `workflow-web` grab-bag residue the decision below warned about — W1–W3
should re-derive and shrink the baseline when they land rather than treat the
159 as settled.

After W1–W3 drain the `workflow-web` grab-bag there will still be roughly 60
web→web edges and 14 core-feature→enterprise edges that are product structure
rather than lift-and-shift residue — each needs a core port plus an enterprise
adapter, or the cross-feature "surfaces" design that has not been written. No
`src/boundary-edge-baseline.json` exists yet. **(a) Build it as designed:** one
entry per edge (`{from, to, expires}`), an unlisted edge fails as today, a
listed edge is silent until it expires, the file may only lose entries or lower
an expiry against the merge-base, and an edge whose `from` or `to` no longer
exists fails as stale. Bootstrapped once, after W1–W3, so the grab-bag never
enters it. **(b) Leave the rule hard-failing** and accept that `pnpm lint` stays
red on ~74 edges until the surfaces design lands. **(c) Widen the rule** to
allow web→web imports generally, which is the option that quietly ends the
boundary. **Recommended: (a).** It satisfies the plan's own ground rule — keyed
by the thing that must go to zero, fails on growth, fails on expiry, never
exempts a changed file — and (b) means the gate teaches people to ignore it.
Lane: `architecture-lint-burn-down-plan.md`.

## 3. tRPC flatten step D: is `ApiApplication.create`'s `features` required?

Steps A and B landed; C and D are the last of the flatten and D cannot start
without this ruling. `features` is optional today
(`apps/api/src/api.application.ts:421`) and `buildFeatureRouters` returns `{}`
without it, so once the record has a real type, `AppRouter =
ApiApplication["trpc"]` is only the full router if `features` is required.
**(a) Make it required,** consistent with step C's decision to make `agents` and
`secrets` required behind `MissingAgentService` / `MissingSecretService`, and
with the codebase's stated preference for null objects over optionality. Cost:
the test call sites that build an `ApiApplication` without a features port need
a small `TestApiTrpcFeatures` that mounts an empty-but-typed record
(`ApiTrpcFeaturesComposition` is ~290 lines and needs a Prisma client, so they
cannot just use the real one). **(b) Keep it optional** and declare `AppRouter`
in `app-trpc.types.ts` from `AppTrpcFeatureRecord` plus the two own routers
rather than reading it off the class — cheaper, but it loses "can never drift
from what the process actually mounts" unless a type-level test pins
`ApiApplication["trpc"]` assignable to `AppRouter`. **Recommended: (a).** The
whole point of step D is that the browser's type cannot drift from the
process's mount; (b) reintroduces exactly the gap by hand. Lane:
`trpc-flatten-review.md`.

## 4. Suite default plan naming, and the by-name REST route it waits on

**Resolved 2026-09-04 as option (a).** `suiteRunPlanInputSchema.name` is
`.optional()`; the tRPC door kept its own `min(1)`. `SuiteService.runPlan`
derives a name via `defaultPlanName` (scope label + target labels) built on
the contract's `derivePlanName`/`targetLabels`, only when the caller sends
none. Landed in the same change that mounted `/api/v1/run-plans/run` (decision
5). One deviation from main: derived target labels carry no connected-agent
environment/owner suffix, since `AgentService.getNamesByIds` on this branch
returns only `{id, name}`. See `suite-restore-review.md`, "Landed 2026-09-04". Original framing follows.

`suiteRunPlanInputSchema` requires `name`
(`packages/features/suite/contract/src/suite.ts:186`), and nothing derives one.
Main derived it. The callers that omit the name are not the web — they are
`sdks/typescript/src/cli/commands/run-plans/run.ts` (whose own doc says "no
name lets the platform derive one from the scope and the targets"), the
`POST /api/v1/run-plans/run` body type in this repo's client SDK, and the MCP
server. None of them reach the gap today because that route is not on the
branch — which makes the naming "not yet wired", not dead. The pieces are
already in the contract: `derivePlanName` (`contract/src/plan-name.ts:29`) and
`targetLabels` (`contract/src/target-key.ts:305`). **(a) Restore
`defaultPlanName` in the same change that mounts the route** — `name` becomes
optional on the contract (blank-only still refused), derived after validation
from the scope label and the target names the service already resolves; the
tRPC door may keep `min(1)`. **(b) Ship the route with `name` required and
change the CLI** — a breaking change for every published CLI already in the
field. **Recommended: (a).** Lane: `suite-restore-review.md` fix 4.

## 5. `/api/v1/run-plans*` and `/api/v1/test-suites*`: ship or retire?

**Resolved 2026-09-04: (a), as recommended — both families built.** Alex's
standing rule is that nothing main shipped is retired on this branch, which
settles it independent of the size argument below. Both families are lifted
onto `SuiteApp`/`SuiteService` in the branch's Hono style and mounted in
`apps/api/src/app-rest/app-rest.packaged-families.ts` beside the deprecated
`/api/suites` alias, reusing the same `services.suites` accessor — no change
was needed to the tRPC-flatten lane's files. See `suite-restore-review.md`,
"Landed 2026-09-04" for the file list and the one field-level deviation
(target-name enrichment). Original framing follows.

Eleven documented REST operations across these two families are unmounted and
**unowned** — no plan claims them, no server file exists, and `suite.api.ts`
mounts `/api/suites` and never `/api/v1/test-suites`. They are in the frozen
OpenAPI document, so the drift guard fails on them, and the published CLI and
MCP server both call `POST /api/v1/run-plans/run`. **(a) Build both families**
onto the existing `SuiteApp` — a real slice, and the one that unblocks decision
4. **(b) Build `run-plans` only** (the CLI path) and retire the `test-suites`
v1 family from the frozen document, since `/api/suites` serves the same
resource. **(c) Retire both from the document** and accept that the published
CLI's `run-plans run` command is broken against this branch. **Recommended:
(a)** if this branch is meant to be deployable, since (c) breaks a shipped CLI
silently; **(b)** if the goal is the smallest merge and the v1 test-suite path
genuinely has no callers — someone should check the SDK and MCP surfaces before
that is assumed. Lane: `restructure-bug-hunt-2026-09-03.md`.

## 6. A producer-only Eventing pipeline factory for the trace and topic pipelines

**Resolved 2026-09-04: (a), as recommended, plus the topic producer factory
from (b).** `annotation-clickhouse-backfill` and `dataset-content-backfill`
are registered (the trace pipeline already had a producer factory,
`createTraceProcessingProducerPipeline` — built earlier for `apps/api`'s
annotation path — so only the two tasks needed wiring).
`createTopicClusteringProcessingProducerPipeline`
(`packages/features/topic/server/src/adapters/topic-clustering-processing-producer.adapter.ts`)
was also built, covering both producer registrations `topic-clustering-run`
needs; it stays unregistered because its runner (model-provider gateway,
langevals, Prisma repository) is still absent — the smaller, honestly-named
remainder of (b), not the full option. See "Open — one unregistered task" in
`tasks-lane-review.md`.

Three tasks are moved into their features, registered nowhere, and blocked on
the same shape. `stalled-runs-backfill` showed the shape works:
`apps/tasks` composes a minimal producer-only Eventing host and registers
`createSimulationProcessingProducerPipeline`, which the scenario package already
exported for exactly this. `annotation-clickhouse-backfill` and
`dataset-content-backfill` both need the **trace** pipeline's producer
registration, which has no equivalent factory; `topic-clustering-run` needs
**two** (`topic_clustering_processing` for `TopicClusteringCommandsPort`, plus
the trace pipeline for `TraceTopicAssignmentPort`) and the whole
`TopicClusteringRunner` besides. **(a) Write
`createTraceProcessingProducerPipeline`'s task-side factory** and register the
two cheap tasks; leave topic-clustering named and unregistered.
**(b) Do all three,** including the topic producer factory and the runner's
collaborator graph. **(c) Delete the three unregistered `Task` subclasses** and
record the operations as retired. **Recommended: (a).** It is one factory of a
shape that already exists once, it unblocks two tasks, and it leaves the
expensive one honestly named rather than half-built. (c) is wrong because a
Task class exported from a feature that no process constructs is exactly the
"optional dep never wired" trap — but so is leaving all three indefinitely.
Lane: `tasks-lane-review.md`, `tasks-launch-interface-and-saas.md`.

## 7. Where the demo project's Langy refusal lives

`apps/api/src/features/langy/langy-trpc.mount.ts` builds a `refuseDemoProject`
gate in the application, ahead of the rollout gate, because the demo project
grants `project:view` to every authenticated user and a permission check alone
would pass. The deployment's demo project id is configuration
(`config.authz.demoProjectId`), and a feature package may not read it — which
is why the gate is composed here rather than declared in langy-server.
`api-production.composition.ts:1663` makes the same call a second time for the
MCP surface (`isDemoProject`). **(a) Keep it as is:** the gate is the
application's, and each surface that needs it composes it from the one config
leaf. **(b) Give the langy contract a `DemoProjectPort`** the process
satisfies, so the refusal is declared with the feature and the id still comes
from configuration. **(c) Move the demo project id into a shared
`@langwatch/config` block** every surface reads, and keep the gates local.
**Recommended: (a), with the second call site folded onto the first.** It is
one predicate over one config leaf and (b) buys a port for a boolean; what is
worth fixing is that two composition sites now answer "is this the demo
project" independently. Lane: `restructure-bug-hunt-2026-09-03.md`.

**RESOLVED 2026-09-04 (frontend half — the backend `refuseDemoProject`/MCP
call sites live under `apps/api/src/app/**`, out of scope here).** The two
apps/ui composition sites that gated Langy visibility (`home-host.tsx`'s
`langyVisibility()`/`canAskLangy()`, `navigation-host.tsx`'s `canAskLangy`)
independently read `config.demoProjectSlug` and neither compared it against
the active project — a demo-project reader got the full Langy home/command-bar
experience and every send 403'd. Added one shared predicate,
`apps/ui/src/behavior/langy-demo-project.ts#isLangyDemoProject`, and folded
both sites onto it (a). Extended `LangyHostPort` (`@langwatch/langy-web`) with
`isDemoProject()`, implemented in `apps/ui/src/features/langy/ui/sections/host.tsx`
using the same predicate, and wired it into the panel's own gate
(`use-show-langy.ts`) — closing the gap its docblock had flagged as
"recorded rather than hidden". Bound `specs/security/api-endpoint-authorization.feature`'s
"The demo project refuses Langy on every surface" in
`apps/ui/src/features/langy/__tests__/langy-host-demo-refusal.integration.test.tsx`;
added a supporting (unbound) case to langy-web's own
`project-langy-layout.integration.test.tsx` proving the panel hides.

## 8. `worker: null` in the API's Langy composition

`api-trpc-collaborators.agent-group.composition.ts:806` sets the Langy turn
service's `worker` port to `null`, with the reason stated in place: no agent
manager runs on a web process, so dispatching is the worker's. In practice a
Langy turn-start on `apps/api` refuses with the feature's own
`langy_agent_unavailable`, and the same composition refuses model resolution
and the pull-request permit reads. Main did not have this split. **(a) Ratify
it:** the API composes the read side and the worker owns dispatch, and a
turn-start on the API is a refusal by design — in which case the browser's
turn-start path must be checked to confirm it never lands here.
**(b) Compose a dispatch producer** on the API the way the trace and simulation
producer registrations already work, so a turn-start enqueues rather than
refusing. **Recommended: (b) if a customer can reach it, (a) if they cannot.**
This is the one item on this list where I could not settle the answer from the
code: the refusal is deliberate and well-documented, but nothing I read proves
which process the browser's "start a turn" button actually calls. That needs
one probe against a running stack before it is ruled either way. Lane:
`core-application-feature-extraction-plan.md`.

## 9. langwatch-saas: keep the plugin fallback, or move the eight tasks in? — **DECIDED: (c), landed**

Option (c) taken: five of the six ordinary tasks moved into this repository's
feature packages as `Task` classes, registered on `apps/tasks`' catalogue;
`backfillInviteUsersToCio` stays a saas-only plugin (genuinely private — a
one-off historical-bug backfill of user PII into Customer.io, not a repeatable
operation). Full mapping, what still needs a rewrite (`onboarding-completion-rate`
is blocked, not moved), and the saas-side follow-up: `tasks-launch-interface-and-saas.md`.

## 10. Which composition-simplification options to schedule, and in what order

Ten options were measured; F and I landed and D landed in part. The remaining
seven are not equally safe and three of them serialise. **A** (shared config
blocks — 59 identical env bindings across the two app configs) and **G**
(worker installers — one ordered array instead of 26 handle classes) are
near-pure deletion on disjoint files. **B** (one absence mechanism, replacing
26 `*AbsenceReport` files, 25 `Logged*Absence` classes and 21
`*UnavailableError` classes) is the largest single win and the precondition for
**C** (splitting the 4,001-line `api-production.composition.ts`) and **H** (one
REST registration list replacing 22 `*rest.mount.ts` files plus five
composition roots). **E** (generate the api-maps) is high-risk and staged and
needs decision 3 first. **J** (web packages export `install`) needs decision 11.
**(a) Take A and G now, B next, and stop to measure.** **(b) Take everything
except E and J.** **(c) Freeze all of it until the branch merges.**
**Recommended: (a).** The branch is already large and unmerged; A and G are
each a day and cannot break anything structurally, B is worth doing before C
and H make the same files harder to reason about, and E and J both want a
settled `AppRouter` first. Lane: `composition-simplification-options.md`.

## 11. The governed web-package fork (blocks option J)

`apps/ui`'s `catalogue.json` carries a `governedWebPackages` allowlist, and a
governed package may not import `@tanstack/react-query` or `@trpc/*`. The host
fold (`268eb2ed83`) put those imports in the feature providers, and option J
would have each web package export its own `install` (loaders + drawers), which
means the package owns the mount. **(a) Widen the governed rule** to accept the
typed client and react-query in `ui/sections/**` only, which is where the
providers already are. **(b) Keep the rule and keep the mounting in `apps/ui`,**
which means option J never happens and `installed-ui-features.ts` stays the
registry. **(c) Drop the governed allowlist** and rely on the transitive
frontend-boundary test alone. **Recommended: (b) for now, revisited after the
api-map lane.** With one shared `trpcReact` instance the per-feature bindings
collapse anyway, which removes most of J's value; deciding this before E lands
is deciding it on the wrong measurements. Lane:
`composition-simplification-options.md`, `architecture-lint-burn-down-plan.md`
R5.

## 12. The result-atoms subsystem: restore on this branch, or after the merge?

Five `scenarios.*` procedures the web calls have no server half, and all five
need the same absent thing: the result-atoms query layer
(`grep -rln "ResultsFilter\|result-atoms"` over the server packages and both
apps returns nothing). Main's `run-configurations.service.ts` (342 lines) and
its ClickHouse repository (192) sit on top of it, and the composition wiring
lands in `api-trpc-collaborators.agent-group.composition.ts`. Today the results
tab, the result rows page, both filter lists and the run-configuration history
panel all throw NOT_FOUND. **(a) Restore it on this branch** — multi-day, and
it is the single largest remaining user-visible regression.
**(b) Merge without it** and restore it as a follow-up, accepting that the
agent-testing results surface ships broken. **(c) Hide the surface** behind a
flag until it is restored. **Recommended: (a) if the branch is meant to ship as
a whole, otherwise (c).** (b) is the one option that puts a broken screen in
front of a customer. Lane: `restructure-bug-hunt-2026-09-03.md` item 2.

## 13. The workbench Langy handoff: restore, or record as retired?

`useRegisterLangyActions` exists in langy-web, has zero consumers, and is not
published from that package's entry point; `workbench.screen.tsx` carries a
deliberate comment saying widening someone else's package mid-flight was
refused. Main's workbench page is 620 lines to the branch's 221 and builds two
things this branch has neither of: proposal handlers and the live UI-action
table (`specs/langy/langy-ui-actions.feature`). Four other pages (me,
automations, analytics, evaluations) hit the same wall. A spec-lift lane
retired the tests. **(a) Restore it** — publish the two hooks and their types
from langy-web, port the action-manifest / narration / run-identification /
target-name modules into the right packages, wire both hooks back in.
**(b) Record it as deliberately retired**, delete `useRegisterLangyActions` and
`UiActionBackendRunner` rather than leaving a declared-and-unwired seam, and
delete the spec. **Recommended: (a).** Langy proposing an action and the page
executing it is the feature's whole shape; (b) removes a shipped capability by
attrition. But (b) beats the status quo, which is a hook nobody calls and a spec
nothing binds. Lane: `restructure-bug-hunt-2026-09-03.md` item 3.

## 14. Comment blocks: is the whole-repo warn tier worth seeing?

R1 made the 4–5 line warn tier print on every `pnpm lint` run **for changed
files only**; the whole-repo warn population is 10,295 blocks. **(a) Leave it,**
so review-time attention goes to the diff. **(b) Print the whole-repo warn tier
too,** which is a 10k-line listing on every run. **Recommended: (a).** (b)
trains people to ignore lint output, which costs more than the blocks do.
Related and separate: the `comment-block-roots.json` expiries are real gate
dates — the `apps/*` tier **expires 2026-09-17** and fails the run when it
does. If the C-slice sweep is not going to happen by then, the dates need
moving deliberately rather than discovering it as a red build. Lane:
`architecture-lint-review-2026-09-03.md`, `architecture-lint-burn-down-plan.md`
§6.

## 15. The two drained lint baselines

**Resolved 2026-09-04: (c), overriding the recommendation.** Alex chose to
delete both files rather than keep `global-app-access-baseline.json` as (b)
recommended. Both rules already treat a missing baseline file the same as an
empty one (`readBaseline`/`readLegacyBaseline` both return `{entries: []}`
when `!existsSync`), so this is behaviour-preserving: `global-app-access`
still forbids `getApp`/`tryGetApp` by name via the `ACCESSOR_FILE`/`ACCESSOR_ALIAS`
constants in `global-app-access.ts` (unchanged), and the legacy application
boundary still fails on any new edge. Only the two JSON files are gone; the
baseline machinery in both rule files, and every other baseline in the
package, is untouched.

`global-app-access-baseline.json` and `legacy-application-boundary-baseline.json`
are both drained to zero and still present. **(a) Keep both** as documented
tripwires. **(b) Keep `global-app-access` and replace
`legacy-application-boundary` with a flat zero-tolerance check,** deleting the
baseline machinery for it. **(c) Delete both.** **Recommended: (b).**
`global-app-access` guards against reintroducing a deleted pattern **by name**
and its `ACCESSOR_FILE` deliberately points at a path that no longer exists —
that is the whole mechanism and it should stay. The application-boundary
ratchet has nothing left to shrink. Lane:
`architecture-lint-review-2026-09-03.md`.

## 16. `experiment-run-orchestrator.service.ts` (3,956 lines)

The `service-quality` module-length rule has 28 files over 500 lines, ten of
them over 900. Nine of the ten are ordinary extractions the burn-down plans as
split lanes. The tenth is the run orchestrator, and the standing instruction
was that "big files are a `mv`". **(a) Split it as its own lane**, deliberately
designed, not as part of a mechanical burn-down. **(b) Baseline it at its
current size** and leave it — the ratchet only shrinks, so it cannot grow.
**(c) Split it mechanically at the blank-line seams** with the other nine.
**Recommended: (a), scheduled separately.** Lane:
`architecture-lint-burn-down-plan.md` Q3.

## 17. PR #7536 is a draft, so nothing in it has been gated

The branch's PR is open as a **draft**, and drafts skip the build and race
jobs — a green draft is not evidence that anything passes. No gate named
anywhere in these plans has been checked by CI. **(a) Mark it ready now** and
read the first full run as the real baseline, accepting that it will be red in
places the plans already predict. **(b) Keep it draft** until the lanes above
close, and gate on local runs. **Recommended: (a).** The branch has been
accumulating for weeks; the first full CI run is information nobody has, and
the longer it is deferred the more expensive it gets. Lane:
`core-application-feature-extraction-plan.md` (`F-BRANCH-01`).

## 18. Two silent-data defects: fix, or ratify?

Both are small and both are decisions about behaviour rather than shape.
**`toLegacyCompatibleCustomModels`**
(`packages/features/model-provider/contract/src/custom-model.ts:45-57`)
`safeParse`s each stored entry against a `.strict()` schema and `flatMap`s
failures away, so an entry carrying an unrecognised key is **silently dropped**
and the model becomes unroutable with no error anywhere. Options: keep the
strict parse but log or refuse on a dropped entry, or loosen the schema to
`.passthrough()` for the legacy read path. **Recommended: keep strict, and make
a drop loud** — a refusal a customer can see beats a model that vanishes.
**`user.homePagePickerState` versus `governance.resolveHome`**: the resolver
excludes personal workspaces (ADR-038 v6) and the picker does not, so the
picker can offer a slug the resolver will never route to. Options: exclude them
from the picker too, or make the resolver accept them. **Recommended: exclude
them from the picker** — the ADR is the authority on where home may point.
Lane: `core-application-feature-extraction-plan.md` (`F-GATEWAY-CAT-01`,
`F-HOME-01`).

**RESOLVED 2026-09-04.** `toLegacyCompatibleCustomModels` now returns
`{ entries, rejected }` (`ParsedCustomModels`); a rejected entry carries only
`{ name }` (its `modelId`, never its full content). Its one production caller,
`gateway-provider-model-catalog.adapter.ts#declaredModelsForProvider`, logs
`rejected` at `warn` by name and keeps declaring the entries that parsed.
Saving already refuses a malformed entry outright — `customModelUpdateInputSchema`
is the tRPC mutation's own `.strict()` input schema — so no separate save-path
change was needed; the defect was read-side only. Bound
"A stored custom model entry that fails the strict parse is dropped loudly" in
`specs/model-providers/custom-models-management.feature`, test in
`custom-model.schema.unit.test.ts`; added a second unit test on the adapter
(`gateway-provider-model-catalog.unit.test.ts`) for the warn-log half.

For the picker: `home-page-picker.tsx` read `firstProjectSlug` off
`homePagePickerState` (unfiltered) instead of `governance.resolveHome`
(filtered). Rather than touch the excluded `apps/api/src/app/**` port
implementations, `PersonaResolution` (governance contract) now echoes the
caller's own (already-filtered) `firstProjectSlug`, and the picker reads that
instead — one source of truth, no new backend port. Bound "The picker's
'Project home' option never names a personal workspace" in
`specs/ai-gateway/governance/persona-home-content.feature`; test in
`home-page-picker.unroutable-project-option.integration.test.tsx`
(`@langwatch/user-web`); resolver pass-through covered in
`persona-home-resolver.unit.test.ts`.

## 19. Two decisions carried over from the exit plan

**Secret compatibility retirement:** whether legacy project-key write actor
handling and duplicate-error text must stay byte-for-byte compatible, or may
converge on the canonical Secret service when `/api/secrets` is retired.
**Observability SDK ownership:** which single LangWatch SDK/OTel entry owns
API, worker and Eventing instrumentation. Neither blocks anything today; both
were recorded as "needed before the named later boundary can close" and that
boundary is now the merge. **Recommended: rule on both at merge time, not
before** — they are cheap to answer and expensive to keep re-reading. Lane:
`core-application-feature-extraction-plan.md`.

---

# Remaining work

Everything open across all thirteen plan documents, grouped by lane. Sizes are
engineering days for one agent unless the row says otherwise, and are for the
work as specified — not for rediscovering the shape.

## Blocking defects (do these first; they are hours, not days)

| Item | Where | Size |
| --- | --- | --- |
| `apps/api/src/index.ts:40,53` re-export `withApiTraceGroupCollaborators` and `withApiGatewayGroupCollaborators`, which step B deleted and nothing defines. `@langwatch/platform-api` does not compile. | `trpc-flatten-review.md` | 10 minutes |
| ~~`normalizePlanScope` (suite contract) and `CLI_EPHEMERAL_LABEL` (suite contract) are restored with **no consumer**~~ — landed 2026-09-04, both wired and the three spec scenarios bound. | `suite-restore-review.md` fixes 3, 9 | done |
| `useRegisterLangyActions` is exported from a module langy-web's entry point does not publish, and nothing calls it. | decision 13 | see below |

## tRPC flatten and the api-map retirement

| Item | Size |
| --- | --- |
| Step C — `agents`/`secrets` required, `PinPresent` deleted, ~20 test call sites | 1 day |
| Step D — drop the `TRPCRouterRecord` cast, delete the type parameters on `ApiTrpcCollaborators` and `AppTrpcFeaturePorts`, export `AppTrpcFeatureRecord` (**needs decision 3**) | 1–2 days |
| api-map lane — 39 `createFeatureApi<` sites → `trpcReact`, delete `feature-api.ts` and `use-invalidate-procedure.ts`, move `trpc-query-key.ts` into apps/ui, collapse the 36 `uiFeatureApi` bindings to one Provider mount, rewrite `feature-web-data-access.md` | 1 week, fan-out-able after the first two conversions |
| `mergeUiPageLoaders` / `UiApplicationInstall.pages.loaders` deletion | half a day |

## Composition simplification

| Option | Item | Size |
| --- | --- | --- |
| A | Shared config blocks in `packages/config`; both app configs spread them (59 identical bindings each today) | 1 day |
| G | Worker installers return an optional closer; delete 26 handle classes and the triple-naming array | half a day |
| B | One absence mechanism: 26 `*AbsenceReport` files, 25 `Logged*Absence`, 21 `*UnavailableError` → one `AbsenceLog` | 2 days |
| C | Split `api-production.composition.ts` (4,001 lines, 55 sibling roots); delete the standalone shim (after B) | 2–3 days |
| H | One REST registration list replacing 22 `*rest.mount.ts` + 2 `app-rest.*` + 5 composition roots (after C) | 1 day |
| E | Generate the api-maps (after step D) | 1 week, staged |
| J | Web packages export `install` (**needs decision 11**) | 1 week |

## Architecture-lint burn-down

Counts predate R1–R6; re-derive before starting any slice.

| Item | Size |
| --- | --- |
| R7 (`rules/` kind) — **needs decision 1** | half a day once ruled |
| R8 (boundary edge baseline) — **needs decision 2**, and W1–W3 first | 1 day |
| A5a–c — adapter doors for the ~56 consumed private exports (**the resume point**) | 3 days |
| A1–A3 — apps/api and apps/worker stop importing enterprise feature packages; plan-gate rename; agent-cache move | 2 days |
| A6a–c — `PrismaClient` named outside the seam, 29 files behind ports | 4 days |
| A7 — Prisma enums and model types into contracts, 30 rows | 2 days |
| A9a–c — `try*` renames, ~100 methods, mechanical `tslsp` | 2 days |
| L1–L6 — 303 layout file moves in eight classes (L2 needs R7) | 2 weeks |
| Q1–Q3 — line length, method length, module-length ratchet + split lanes | 3 days (plus decision 16) |
| W1, W3 — design-system promotion and the prisma-types rows (**W2 is in progress in the working tree**) | 3 days |
| A12, A13, A15–A19 — web layout, layer direction, cycles, screen capabilities, apps/ui features, server→server edges, singletons | 4 days |
| C0–C5 — ~110 comment-block slices, 20,137 blocks; **the `apps/*` root expiries fire 2026-09-17** | ~110 agent-sittings |

## Connected agents (ADR-128) — live lane

| Item | Size |
| --- | --- |
| Slice 7, `apps/api` half — two config leaves, `ApiConnectCredentialAdapter`, `ApiConnectedAgentsComposition`, the `"agents-v1"` family mount, `AgentApp.connected.presence` wiring, `ApiUpgradeRouter` into the listener, drain order | 2 days |
| The four `apps/api` integration suites Slice 7 unblocks (15 + 11 + 4 + 2 scenarios, Postgres + Redis) | 1 day |
| Slice 8 — the `connectedSection` host slot on the agents page | half a day |
| Slice 9 — parity sweep across the three connected-agent specs | half a day |
| De-duplicate `agent-v1.api.ts`'s own presence enrichment onto `AgentApp` | half a day |

## Suite run plans

| Item | Size |
| --- | --- |
| Fix 3 — the `cli-ephemeral` `NOT` clause, using the constant already in the contract | 30 minutes |
| Fix 5 / 11 — `repeatCount` cap and the door's duplicate schema | 30 minutes |
| Fix 6 — use `planNameKey` and main's lock prefix and hash, plus the transaction timeout | 1 hour |
| Fix 7 — batch the model resolve (a `getModelChoices` on `ScenarioService`); today it is one `tryGetById` per scenario at queue time | half a day |
| Fix 8 — make the two "refuses before touching the plan row" tests assert it | 1 hour |
| Fix 9 — call `normalizePlanScope` from `runPlan` and bind the three `@unit` scenarios | half a day |
| Fix 4 — `defaultPlanName` (**needs decisions 4 and 5**) | 1 day |
| The 22 `@integration` scenarios — a Postgres-backed repository suite plus a `vitest.config.ts` that names the datastore | 2 days |

## Tasks and langwatch-saas

| Item | Size |
| --- | --- |
| Fix 16 — lazy handle composition on `TasksHost`, plus the eight lifecycle tests (plan is written) | 1 day |
| Fix 18 — audit the remaining `stored-object/server` index exports individually | half a day |
| The trace producer-only pipeline factory; register `annotation-clickhouse-backfill` and `dataset-content-backfill` (**needs decision 6**) | 2 days |
| Move `WorkerDatasetStorageResolver` into `dataset/server/adapters` and fill `TasksHost.objectStorage` | half a day |
| `topic-clustering-run` — the runner's collaborator graph plus two producer registrations | 3 days |
| langwatch-saas PR — delete the 5 moved tasks, keep `backfillInviteUsersToCio` as a `@langwatch/task` plugin, drop the submodule, build `FROM` the public image (decision 9 **DECIDED**) | 1 day, other repo |

## Unserved surfaces and restored features

| Item | Size |
| --- | --- |
| `/api/v1/run-plans*` and `/api/v1/test-suites*` — 11 operations, unowned (**needs decision 5**) | 3 days |
| The result-atoms query layer, then `run-configurations` service/repository/router, then the composition wiring — unblocks five procedures (**needs decision 12**) | 1 week |
| The workbench Langy handoff — publish the two hooks, port the manifest/narration/run-identification modules, rewire the screen (**needs decision 13**) | 1 week |
| Regenerate the OpenAPI artefacts, last, on the merged branch | half a day |

## Cross-cutting and operational

| Item | Size |
| --- | --- |
| `make haven install` after this branch lands — a pre-removal binary hard-refuses at boot | 1 minute, everyone |
| Mark PR #7536 ready and read the first full CI run (**decision 17**) | — |
| `F-GATEWAY-CAT-01` and `F-HOME-01` (**decision 18**) | half a day together |
| `F-TRACE-01` — the extracted full-read path trusts a stale storage-anchor hint | 1 day |
| `F-AGENT-01` — refresh `specs/agents/AUDIT_MANIFEST.md` (rides with connected-agents Slice 9) | 1 hour |
| `F-LINT-02` — wire `oxlint-tsgolint`, restoring four type-aware rules | 1 day, needs a capable machine |
| Read `oxlint-plugin.mjs` against `service-quality.ts` and `manifests.ts` to settle the claimed rule overlap | half a day |
| Re-verify the four residual unknowns from the bug hunt: REST body-shape drift on ~253 mounted operations, procedure-level gaps inside mounted namespaces, the haven migration `context canceled`, and worker job-processing behaviour | 2 days |
