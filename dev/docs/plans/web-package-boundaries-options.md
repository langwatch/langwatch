# Web package boundaries: what the cycles are made of, and five ways out

**Status:** investigation, 2026-09-15. No code was changed; this document is the
deliverable. All numbers were measured on this tree (branch
`feat/strict-feature-layout-v0`) with scripts over `modules/*/web/package.json`
and `grep` over `modules/*/web/src`; the rule logic was read from
`packages/oxlint-rules/src/rules/package-boundaries.rule.mjs` and
`packages/architecture-enforcer/src/policies/`.

**The question, in the requester's words:** *"installing the frontend should not
be imported by another package, but any package could use the hooks"* — and
ideally no circular package imports at all.

**The one-paragraph answer.** Those are two separate problems, and the evidence
says they barely overlap. The ~84 lint findings are almost entirely healthy
parts-sharing under pre-convention export names — fixing them is a mechanical
rename that kills **zero** cycles. The cycles live in the *legal* `surfaces/*`
import graph: one strongly connected component of 14 packages, held together by
(a) platform capabilities parked inside feature packages (a typed tRPC facade
in `workflow-web` alone accounts for 66 cross-package imports) and (b) genuine
mutual embedding inside the optimization-studio cluster. Killing the cycles
means extraction and a handful of directional decisions, not a new export tier.

---

## 1. The measured picture

### 1.1 The graph

- **35** web packages under `modules/*/web` (41 counting
  `enterprise/modules/*/web`).
- **75** declared web → web `package.json` dependency edges inside `modules/`
  (83 with enterprise; the brief's 77 was measured on a slightly different tree
  state — same order of magnitude, same shape).
- **One strongly connected component of 14 packages**: agent, analytics,
  coding-agent, dataset, evaluator, experiment, langy, model-provider,
  onboarding, project, prompt, scenario, trace, workflow. Every cycle in the
  web graph runs inside this one component.
- **14 direct mutual pairs**: agent↔scenario, analytics↔evaluator,
  coding-agent↔trace, dataset↔workflow, evaluator↔experiment, evaluator↔trace,
  evaluator↔workflow, experiment↔prompt, experiment↔workflow, langy↔trace,
  model-provider↔prompt, model-provider↔workflow, prompt↔workflow,
  scenario↔trace.
- **2,018 elementary cycles** (full enumeration inside the SCC, lengths 2–13).
  The brief's "23 cycles" is what the enforcer's `lintCycles` DFS reports for
  web packages — a traversal-order-dependent sample, not a count of distinct
  cycles. Running the same DFS today reports **26**, of which **3 are
  contract-package cycles** (see §5, option C): `scenario-contract ↔
  suite-contract`, a five-contract ring through
  `evaluation → experiment → dataset → annotation → trace → evaluation`, and a
  five-contract ring through `scenario → automation → monitor → evaluation →
  experiment → scenario`.
- **Hubs.** Out-degree: trace-web 12, scenario-web 8, experiment-web and
  workflow-web 7 each. In-degree: model-provider-web, trace-web and
  workflow-web 8 each, prompt-web 6.

The most consequential measurement in this investigation:

> **The ~84 violation imports, taken alone, form no cycle at all.** Building
> the import graph from only the violating (non-`surfaces/`) imports yields an
> acyclic graph. Building it from only the *legal* `surfaces/<id>` imports
> yields a 13-package strongly connected component (everything above except
> agent). Fixing every lint finding therefore removes exactly one package from
> the ring and leaves the other thirteen cyclic.

So "clear the 84 findings" and "kill the cycles" are almost disjoint work
items. Any plan that treats the findings burn-down as the cycle fix is
measuring the wrong thing.

### 1.2 What the enforcement stack already says

Three layers enforce related but not identical rules today:

1. **`langwatch/package-boundaries`** (oxlint, severity `error`,
   `packages/oxlint-rules/src/rules/package-boundaries.rule.mjs`). For
   web → web imports it allows exactly two shapes: a subpath matching
   `./surfaces/<id>` (`webSurfaceImport`, allowed from *any* web package with
   no declaration required), and an exact specifier declared in
   `apps/ui/src/features/catalogue.json` under a frontend feature whose `root`
   equals the importing module's feature name (`declaredWebDependency`). A
   `./testing` subpath is a third, test-only door. Everything else —
   the bare package root, any flat entry — reports `crossFeature`.
2. **The architecture-enforcer manifest policy**
   (`src/policies/boundaries/manifests.ts`): a `package.json` dependency on
   another feature's web package is itself a `cross-feature` violation unless
   the pair is derivable from the catalogue
   (`declaredWebDependencyPairs`, `frontend-ui-boundaries.ts:2292`). **78 web →
   web manifest edges are currently baselined** in
   `src/boundary-edge-baseline.json` — and every entry in that file **expires
   2026-10-01**, two weeks from this writing. The policy has
   `enforceExpiry: true`, refuses new entries, and refuses moving an expiry
   later. Doing nothing is therefore not a stable state; it is a countdown.
3. **`lintCycles`** (`src/policies/boundaries/cycles.ts`): reports
   `package-cycle` violations from declared manifests. No baseline file admits
   these; on this branch they are live findings the strict-layout drive is
   working through.

Neither the oxlint rule nor the manifest policy checks *direction*: two
packages may each legally import the other's `surfaces/*`, and nothing anywhere
enforces acyclicity of the cross-package web graph (the "acyclic" guarantees in
ADR-004 cover the app → feature → platform layering and the *private* feature
graph inside one package, not the graph between web packages).

### 1.3 The convention that half-exists — and what `surfaces/` actually means

Export census across the 35 web packages (276 subpath exports today):

| Tier | Count | Examples |
| --- | --- | --- |
| `./surfaces/*` | 183 | `workflow-web/surfaces/workflow-api`, `analytics-web/surfaces/period-selector` |
| Flat named entries | 70 | `./simulations`, `./drawers`, `./run-formatters`, `./agent-client` |
| Bare root `.` | 15 | `presence-web`, `share-web`, `feature-flag-web` |
| `./testing` | 5 | suite-web, annotation-web, … |
| `./screens/*` | 2 | (the ADR-004 owner-only form — barely adopted) |
| `./hooks/*` | 1 | onboarding-web (not a real tier) |

Two facts that correct the brief's framing:

- **`surfaces/` is the *shared* tier, not the private one.** ADR-004
  (`packages/architecture-enforcer/adrs/004-frontend-feature-boundaries.md`)
  defines `screens/<name>` as owner-only and `surfaces/<name>` as "a narrow
  controlled cross-feature contribution"; the spec
  (`specs/frontend-feature-boundaries.feature`) has since softened a surface to
  "the public door onto its package implementation", explicitly allowed to
  re-export the package's own model, behavior and ui layers, and explicitly
  allowed to build on another feature's declared surface. The oxlint rule
  implements exactly that: any web package may import any other's
  `surfaces/<id>`. Option A as worded in the brief ("`./surfaces/*` stays
  private to the feature and its host app") is the inverse of what the tree,
  the ADR, the spec and the rule all already mean. The "installing the
  frontend" tier the requester wants protected also already exists: it is the
  flat feature entries (`./simulations`, `./traces`, `./analytics`) plus
  `./drawers` (drawer-registry registrations), consumed only by
  `apps/ui` through catalogue `uses.screens` — and **none of the 84 findings
  imports one of them** (see §2).
- **`surfaces/` is a naming convention on export subpaths, not a physical
  layout.** 179 of the 183 surface exports map to arbitrary internal files
  (`src/model/...`, `src/ui/sections/...`, `src/behavior/...`); only trace-web
  has physical `src/surfaces/` directories (4), plus one in workflow-web
  (`surfaces/code-agent` — which is also the only surface source file that
  imports another web package). ADR-004's surface *closure* rules (no stores,
  no transport, no fetch) are consequently unenforced in practice and already
  broken by design: `workflow-web/surfaces/workflow-api` is a typed tRPC
  client whose source comments call itself "ADR-004's one governed-closure
  exception", and `langy-web/surfaces/langy-store`,
  `suite-web`'s `run-history-store` equivalent and
  `trace-web/surfaces/trace-drawer-store` are stores. Any option that leans on
  "surfaces are pure presentational contributions" is leaning on a rule the
  tree gave up on months ago.

The violations, then, are not a missing concept. They are seven packages whose
public parts predate the namespace: suite-web, annotation-web, share-web,
presence-web, agent-web (partially), feature-flag-web and organization-web
export their parts as flat entries or the bare root, and the rule cannot tell
those apart from private internals.

---

## 2. Classification of the 84 cross-feature web imports

Reproduced exactly by simulating the rule's logic over `modules/*/web/src`:
**84 findings** (68 in production source, 16 in test files), every one of them
importing a subpath the target package *does declare* in its `exports`
(sealed-exports violations among these: zero). Per edge and entry, with what
the entry actually exports (read from the entry files):

| Edge | Entry | Count | What it is | Class |
| --- | --- | --- | --- | --- |
| scenario → suite | `run-formatters` | 24 (19p+5t) | pure model: status labels/config, polling interval, run-history transforms, output-field state; plus one `ui/sections` filter bar | **part** (model) |
| scenario → suite | `run-cards` | 13 (5p+8t) | presentational cards/rows/sections: scenario-grid-card, simulation-card, run-row, batch-section, status icons | **part** (presentational) |
| scenario → suite | `run-dialogs` | 7 (6p+1t) | prop-driven dialog components + context menu + NowProvider (not registry drawers) | **part** (interactive) |
| scenario → suite | `run-history-store` | 3 (2p+1t) | behavior stores: use-run-history-store, use-auto-expansion, use-scroll-to-batch | **shared state** |
| scenario → suite | `suite-pickers` | 2 | scenario-picker, target-picker elements | **part** |
| scenario → suite | `suite-form` | 1 | use-suite-form hook + form types | **part** (behavior) |
| trace → presence | bare root | 14 (13p+1t) | avatars, markers, presence sections **and** usePresenceStore/selectors, preferences store, tab-session id | **part** (~9) + **shared state** (~5) |
| trace → annotation | `annotation-form` | 4 | form body/score blocks + model types | **part** |
| trace → annotation | `annotation-chips` | 1 | three chip elements | **part** |
| trace → annotation | `annotation-card` | 1 | one card block | **part** |
| trace → share | `share-links` | 2 | pure model: shareUrlForToken, copyShareLink, expiry | **part** (model) |
| trace → share | `share-link-views` | 2 | create-form, row, list, dialog-body components | **part** |
| trace → suite | `run-formatters` | 1 | as above | **part** (model) |
| workflow → agent | `agent-editors` | 4 | the entry exports whole drawers, but all four sites import only three pure model functions (`buildCodeConfig`, `DEFAULT_CODE`, `getCodeFromConfig`); three of the four sites are re-exports (`workflow/web/src/index.ts:48`, `code-agent.ts`, `surfaces/code-agent/index.ts` — the last being the tree's only surface-closure breach) | **part** (model, mis-bundled inside a drawer-heavy entry) |
| workflow → agent | `agent-http-editor` | 1 | HTTP test-panel components + messagesToJson model | **part** |
| scenario → agent | `agent-client` | 3 | typed API facade (`agentApi`), client types, `agentHasDevTunnel` | **transport client** |
| ops → feature-flag | `experiment-catalogue` | 1 | operator catalogue sections + experiments dialog + watermark | **part** (operator console composition) |

**Totals: ~73 reusable parts (category 2), ~11 shared state / transport clients
(a third category the brief anticipated), and 0 whole feature surfaces
(category 1).** Not one of the 84 imports a screen, a routed drawer
registration, or a feature entry point. The failure mode the requester fears —
one feature installing another feature's frontend — is already prevented by the
existing rule (screens and flat entries are owner-only via the catalogue) and
does not occur in the findings. What the findings actually are: the parts tier
under seven packages' pre-`surfaces/` names.

Two supporting observations:

- `modules/suite/README.md` states suite-web's charter as owning "the reusable
  scenario-run card, message preview, status configuration, and completion
  treatment" — suite-web *is by design* a parts library (it has no `screens/`,
  no `surfaces/`, and depends only on two contract packages; it sits outside
  the SCC). The 50 scenario → suite findings are a consumer using a leaf parts
  library through the wrong door, not coupling.
- The host application already blesses these exact entries: the `simulations`
  frontend feature in `apps/ui/src/features/catalogue.json` declares all six
  suite-web entries (and agent-web's `agent-editors`/`agent-client`/
  `agent-http-editor`) under `uses.surfaces`. The findings exist because both
  allowlist mechanisms key on the *frontend feature root* (`simulations`), and
  no catalogue feature has root `scenario` — so `modules/scenario/web` can
  never be allowlisted for the same imports as the mechanism stands. The
  module-level sibling of an already-approved host-level dependency is what is
  red.

---

## 3. What the cycles are actually made of

Since the violations do not form the cycles, the cycles must be read from the
legal edge table (every SCC edge with the surfaces it imports). Digesting that
table, the SCC is held together by four distinguishable causes:

### 3.1 Platform capabilities parked in feature packages (the biggest single cause)

- **`workflow-web/surfaces/workflow-api`** — a typed tRPC client facade over
  agent, dataset, evaluator, model-provider and prompt procedures — is
  imported **66 times from 6 other web packages** (experiment 32, evaluator 13,
  dataset 7, prompt 7, analytics 4, model-provider 3). It is the main reason
  workflow-web's in-degree is 8.
- Also in workflow-web: `feature-flag` (the flag hook, 5 external imports),
  `handled-error-views`, `isolated-error-boundary`, `markdown`, `copy-button`,
  `format-money`, `hoverable-big-text`, `fetch-sse`, `render-code` — none of
  them workflow-domain.
- Elsewhere: `analytics-web/surfaces/period-selector` (a generic date-range
  picker, 29 imports — 27 of them the entirety of the scenario → analytics
  edge), `ops-web/surfaces/keyboard-key` (15), `authz-web/surfaces/scope-picker`
  (25, legal and directionally fine).
- Duplication corroborates the misplacement: `isolated-error-boundary` exists
  in both workflow-web and trace-web; `format-milliseconds` in trace-web and
  analytics-web's model; `format-money` in workflow-web and analytics-web.

**What-if, measured:** moving just the generic set out of workflow, analytics,
trace and model-provider deletes five edges *entirely* (analytics → workflow,
model-provider → workflow, langy → workflow, experiment → model-provider,
scenario → analytics — 44 import statements) and thins most others. The
14-package SCC **still survives** — extraction is necessary pressure relief but
not sufficient.

### 3.2 The optimization-studio cluster's mutual embedding

After the extraction above, a weighted minimum-feedback-arc computation (exact,
subset DP over the 14 SCC members, weighted by import statements) says the
graph is **51 import statements across 14 edges away from acyclic**. The heavy
residual back edges are all in the studio cluster:

- workflow → prompt (13: `variables`, `llm-config-popover`, `outputs-section`,
  `prompt-editor-drawer`, …) while prompt → workflow also exists
  (`component-types`, `workflow-code-editor`, `studio-scope`, …)
- workflow → experiment (7: `batch-results`, `workbench-types`, …) and
  workflow → evaluator (5: `evaluator-result-chip`, `evaluator-editor-content`,
  …), while evaluator → workflow and experiment → workflow carry the studio
  embedding the other way
- prompt → experiment (5: `workbench-types`, `evaluation-mappings`,
  `mapping-validation`)

This is one product (the studio + its workbench + its evaluators) cut into six
modules whose screens genuinely compose each other in both directions. No
naming convention fixes it; only ownership moves and a declared layer order do.

### 3.3 Stores and drawer-opening across packages

`coding-agent → trace` exists solely to import
`trace-web/surfaces/trace-drawer-store` (opening the trace drawer);
`langy-web/surfaces/langy-store` and `langy-context` are imported by trace,
project, scenario and experiment; `experiment` already uses
`langy-page-registration` — the inversion pattern — for the same relationship.
These edges are what the existing registries were built for: the drawer
registry (`packages/ui-drawer` + catalogue install,
`dev/docs/best_practices/drawers.md` §"The drawer registry"), `uiSlots`
(`@langwatch/browser-host/slots`), and `langy-page-registration`.

### 3.4 Types and constants riding in web packages

Several residual back edges consist entirely or mostly of types/pure model:
`analytics → evaluator` (`evaluation-types`), `model-provider → prompt`
(`llm-config-constants`), `onboarding → project` (`tech-stack`),
`prompt → experiment` (`workbench-types` et al.), parts of
`workflow → experiment` (`workbench-types`, `batch-evaluation-state`). These
are contract material that never moved.

---

## 4. The options

### A. Tiered subpath exports (finish the existing convention)

**Corrected form.** The brief's version (surfaces private, new `./shared/*`
tier) contradicts the ADR, the spec and the rule (§1.3); implementing it would
churn 183 existing exports and invert the tree's established vocabulary. The
viable form of A is the one the tree already chose: **`surfaces/*` is the
shared parts tier; flat feature entries, `./drawers` and `screens/*` are the
host-app-only install tier; finish migrating the seven pre-convention
packages.** Concretely: rename ~25 flat entries (suite-web ×6,
annotation-web ×3, agent-web ×3 of 5, share-web ×2, feature-flag-web ×1,
organization-web ×2, presence-web root → named surfaces) to `./surfaces/<id>`,
rewrite the 84 import sites, update the catalogue's `uses.surfaces` strings.

- **Cost:** low. Mechanical rename + import rewrite; a day or two of lane work;
  no design decisions; no behavior change.
- **Rule change:** **none for the oxlint rule** — `webSurfaceImport` already
  passes `./surfaces/<id>`. One real change at the manifest level: the
  enforcer's `declaredWebDependencyPairs` cannot express "module-web X uses
  module-web Y's surface" unless a catalogue frontend feature root happens to
  equal X's module name (it doesn't for scenario). Either the manifest policy
  learns the same surfaces allowance the oxlint rule has, or module-web
  packages get their own declaration (a `uses` block in the module's
  `feature.json`, mirroring the catalogue). The second is better: it keeps
  cross-feature edges visible in review, which is the point of ADR-004's
  catalogue.
- **Effect on the 84:** → 0.
- **Effect on the cycles:** **none.** Proven in §1.1 — and it *legalizes* the
  agent↔scenario pair rather than removing it. This option is the relabel the
  brief suspected. It is still worth doing, because an inconsistent convention
  is unenforceable and every future package will copy whichever shape it sees
  first — but it must be sold as consistency work, not as the cycle fix.

### B. Extract shared packages

Two sub-moves with very different risk profiles:

**B1 — move platform capabilities to the existing shared tier.** The homes
already exist: `packages/design-system` (markdown, copy-button, period-selector,
keyboard-key, format-money/milliseconds, hoverable-big-text,
isolated-error-boundary — deduplicating the two copies),
`packages/handled-error` (handled-error-views belongs beside the presentation
registry), `packages/ui-host` or a new small `packages/browser-trpc` (the
typed tRPC facade — it imports only contract types, so it sits below every web
package by construction; same for `fetch-sse`/`sse-subscription`). Note
`packages/ui-drawer` and `ui-host` prove this tier already exists for web code;
no `-web-kit` invention is needed.

- **Cost:** moderate. ~15–20 modules of code move; ~120 import sites rewritten
  (66 of them `workflow-api` alone). Each move is independently shippable.
- **Rule change:** none. Shared packages are not feature packages, so
  `crossFeature` simply stops firing.
- **Effect on cycles:** deletes 5 of the SCC's edges outright and most of
  workflow-web's in-degree; **measured: the SCC still survives.** Necessary,
  not sufficient.
- **Effect on the 84:** none directly (the 84 are elsewhere).
- **Risk:** a "common" package becoming a dumping ground. Mitigate by only
  moving things with ≥2 consuming features and no feature-domain vocabulary in
  their types.

**B2 — a parts package per cluster.** suite-web *is* this pattern, already
working: a leaf parts library (contracts-only dependencies) under the scenario
product area. Creating one for the studio cluster is the big-bang version of
the §3.2 problem and should not be attempted as a first move.

### C. Push shared view models into contracts

Applies to the §3.4 material: `evaluation-types`, `workbench-types`,
`llm-config-constants`, `batch-evaluation-state`, `tech-stack`,
`mapping-validation` (if genuinely transport-neutral), the `media-part` model
(not its component), `parameter-line` model. Roughly 20 of the residual 51
back-edge imports.

- **Cost:** low per item; each is a small move plus import rewrites.
- **Two hard constraints.** (1) Contracts are transport- and runtime-neutral —
  the rule enforces it, and the brief notes ~10 existing findings where
  contracts already import browser runtime; C must not become "components in
  contracts". (2) **The contract graph already has three cycles of its own**
  (§1.1), including `scenario-contract ↔ suite-contract` — a type moved into a
  contract that participates in a ring just relocates the cycle one tier down.
  Every C move needs a direction check against the contract graph first.
- **Effect on cycles:** breaks the type-only back edges (analytics → evaluator,
  model-provider → prompt, onboarding → project, most of prompt → experiment).
  Combined with B1 it takes the residual from 51 imports / 14 edges to roughly
  30 imports / 10 edges.
- **Rule change:** none — contracts are already the universally legal import.

### D. Inversion / registries

The machinery exists and is in production use: the drawer registry
(`packages/ui-drawer`; features publish `{ key: lazyDrawer(...) }`, `apps/ui`
installs, consumers open by name), `uiSlots`, `langy-page-registration`
(experiment-web already registers its workbench handlers with langy instead of
langy importing the workbench), and the `*-host` modules
(`model-provider-host`, `prompt-host`). The measured "analytics-registry" is a
static metrics vocabulary, not an inversion mechanism — the real precedents are
the four above.

- **Applies to:** the §3.3 store/drawer edges — coding-agent → trace
  (`trace-drawer-store` → open by drawer name), the langy-store consumers
  (extend the registration pattern experiment already uses), workflow ↔ agent's
  drawer half (the drawers in `agent-editors` should be reached through the
  registry; the three pure functions belong in `agent-contract`). Perhaps 6–8
  edges total.
- **Cost:** highest per edge — each inversion is an API design, adds
  indirection, and makes call sites harder to trace. Using it for parts-sharing
  (the 73 findings in §2) would be architecture theater.
- **Effect on cycles:** kills exactly the mutual pairs it is applied to, which
  are otherwise the hardest to break.
- **Rule change:** none immediately; ADR-004's planned overlay-intent lint is
  the eventual guard.

### E. Do nothing structural; baseline the debt

Stated fairly: the product ships today with the 14-package SCC; ESM tolerates
package-level cycles; users see nothing. The honest costs over a year:

- **It is not actually "nothing".** The boundary-edge baseline's 78 web → web
  manifest entries all expire **2026-10-01** with `enforceExpiry: true`, growth
  refused, and later expiries refused. Doing nothing means CI fails in two
  weeks, so option E in practice means *amending the baseline policy* — a
  structural decision wearing a different hat. Meanwhile the 84 oxlint findings
  and the 26 `package-cycle` findings have no baseline file at all; they are
  live errors this branch's drive is expected to pay down.
- **Tooling.** TypeScript project references are ruled out while cycles exist
  (the `declaration-project-references` policy special-cases them today);
  `typecheck:one` on any SCC member drags in the other thirteen; the SCC is a
  14-package blast radius for every refactor inside it.
- **Drift.** Every new package that imports a hub copies the pattern; the SCC
  has only grown (agent joined it via one 3-import edge). A baseline without a
  direction rule ratchets nothing.
- If the team genuinely decides the SCC is acceptable, the coherent version of
  E is to *change the rule to say so* (drop the manifest cross-feature check
  for surfaces-only deps, delete the expiring entries) rather than to keep a
  baseline that misdescribes intent. That is a legitimate position; it should
  be taken explicitly or not at all.

---

## 5. Recommendation

**Do A (corrected form) immediately, then B1 + C as the actual cycle work,
with D reserved for the store/drawer edges. Decline B2. Decline E, but adopt
its honesty: declare the target direction per cluster before breaking edges.**
Sequenced:

1. **First step — finish the tier migration (option A), starting with
   scenario → suite.** Rename suite-web's six entries to `./surfaces/*`,
   rewrite the ~50 sites, update the catalogue strings; then the same for
   annotation, share, presence, agent's three part-entries, feature-flag,
   organization. This is 84 → 0 findings with zero rule changes and zero
   design decisions, and it makes the convention consistent enough to enforce.
   **scenario → suite is the right start, not a trap**: it is 50 of the 84 in
   one direction, the dependency is architecturally correct already (suite-web
   is a leaf parts library by charter, outside the SCC), and the change is
   purely lexical. The actual traps are the two tempting alternatives: starting
   with the `workflow-api` extraction (highest count, but requires designing a
   client package first) or starting inside the studio cluster (requires
   product-level layering decisions). Do the mechanical thing first.
   Alongside the renames, give the manifest layer a way to say what the oxlint
   layer already allows (a `uses` declaration per module web package, or teach
   `manifests.ts` the surfaces allowance) so the corresponding
   boundary-edge-baseline entries can be *deleted* rather than expiring red.
2. **Second — extraction (B1), `workflow-api` first.** One new
   `packages/browser-trpc` (contract-typed tRPC facade; contracts-only
   dependencies) plus moving the generic UI pieces into
   `packages/design-system` and `handled-error-views` into
   `packages/handled-error`. Deletes five SCC edges and ~120 hub imports, and
   pays down the largest slice of the expiring baseline.
3. **Third — contract moves (C) for the type-only back edges**, each move
   direction-checked against the existing contract cycles; **and inversion (D)
   for the store/drawer edges** (trace-drawer-store, langy-store consumers,
   workflow ↔ agent's drawer half — the three pure `agent-editors` functions go
   to `agent-contract`, which alone deletes the workflow → agent edge and with
   it the tree's only surface-closure breach).
4. **Then, and only then, add the missing enforcement: direction.** Nothing
   today checks acyclicity of the web graph. Once steps 2–3 shrink the SCC,
   drive `lintCycles`' web-package cycle count to zero cluster by cluster with
   a shrink-only counter (the enforcer's existing baseline idiom), and declare
   the studio cluster's layer order (model-provider and dataset below prompt,
   prompt below workflow, workflow below experiment/evaluator screens — the
   residual back-edge list in §3.2 is the worklist) so the last ~30 imports
   have a stated direction to move toward. A new lint tier is not needed;
   the existing `package-cycle` policy plus a ratchet is.

**What this does not promise:** step 1 kills no cycles (measured, §1.1), and
steps 2–3 still leave a studio core whose acyclicity requires real ownership
moves. The minimum surgery from here to a fully acyclic web graph is 64 import
statements across 16 edges (51 across 14 after extraction) — small in
absolute terms, but every one of those is a decision about which feature owns
a piece of UI, and no convention makes those decisions for us.

---

## 6. Where the brief's framing was wrong, stated plainly

1. **`surfaces/` already means "shared", not "private".** Option A as written
   in the brief inverts the tree's existing convention (rule, ADR-004, spec).
   The private tier the requester wants exists too: flat feature entries,
   `./drawers` and `screens/*`, owner-declared in the catalogue.
2. **The 84 findings and the 23 cycles are different problems.** The violation
   edges form no cycle; the cycles are made of legal surfaces imports. A plan
   that burns down the findings and declares victory over the cycles has fixed
   nothing directional.
3. **"23 cycles" undercounts the structure.** It is one 14-package SCC with
   2,018 elementary cycles; the 23/26 number is a DFS sample. Conversely,
   "cycles" overstates the surgery: 64 import statements is the measured
   distance to acyclic.
4. **None of the 84 imports a feature surface.** The classification the brief
   asked for came out ~73 parts / ~11 stores-and-clients / 0 screens. The
   feared category is already prevented by the existing rule.
5. **ADR-004's surface closure (no stores, no transport) is dead in practice**
   — 179 of 183 surfaces are export names over arbitrary internals, and the
   tree's most-imported surface is a tRPC client that documents itself as the
   exception. Any option built on surface purity would be built on sand; the
   spec has already retreated to "public door".
6. **Contracts are not automatically cycle-safe** — the contract graph has
   three cycles of its own, including `scenario-contract ↔ suite-contract`, so
   option C needs a direction check per move.
7. **The clock is already running**: the 78 baselined web → web manifest edges
   expire 2026-10-01 under a policy that refuses postponement. "Do nothing" is
   not on the menu; the real choice is which structural answer to give before
   the baseline forces an ad-hoc one.
