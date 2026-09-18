# Web package boundaries: the migration plan

**Status:** approved plan, 2026-09-15. Derived from
[`web-package-boundaries-options.md`](./web-package-boundaries-options.md)
(the approved options analysis); every count below was re-measured on this tree
today — commands in the footnotes. Lane manifests live in
`.claude/manifests/web-1-*.md` … `web-16-*.md`.

**Governing records:** ADR-001 (feature package boundaries are executable) and
ADR-002 (versioned strict feature layout) in
`packages/architecture-enforcer/adrs/`; ADR-004 (frontend features expose
owner-only screens and narrow surfaces), same directory — the surface/screen
tier definition this plan finishes rolling out; dev/docs ADR-101 (feature
package surfaces), ADR-112 (singular feature ownership — the warrant for the
ownership moves in lanes 9–12 and 16), and ADR-136 (package and layer
boundaries, Proposed).

---

## 1. Target state

Web packages sit in three tiers. **Host-install tier:** flat named entries
(`./annotations`, `./agent-management`), `./drawers` and `./screens/*` are
consumed only by `apps/ui`, declared in
`apps/ui/src/features/catalogue.json` — one feature installing another
feature's frontend stays impossible. **Shared parts tier:** anything a sibling
web package may import is exported under `./surfaces/<name>` — the oxlint rule
(`packages/oxlint-rules/src/rules/package-boundaries.rule.mjs:299-302`) allows
a web → web import exactly when the subpath matches `/^\.\/surfaces\/[^/]+$/`
(any web package, no declaration required at the import layer), when the exact
specifier is catalogue-declared for a frontend feature whose `root` equals the
importing module's feature name, or when a recognized test source imports
`./testing`; every other subpath, including the bare package root, reports
`crossFeature`. **Contract tier:** types, schemas and pure model live in
`*-contract`, importable by anyone. On top of the import-shape rule, the
manifest layer gains a per-module declaration seam (lane 1) so that a
module-web → module-web `package.json` dependency justified by surface use is
declared and legal rather than baselined, and `lintCycles` keeps reporting
package cycles until the graph is a DAG. `surfaces/*` is the **shared**
cross-feature tier — the options doc's §6.1 correction stands; nothing in this
plan inverts it.

## 2. The measured baseline (re-verified 2026-09-15)

- 35 web packages under `modules/*/web`, 6 more under
  `enterprise/modules/*/web`.[^pkgs]
- 77 declared web → web dependency edges inside `modules/`, 7 more in
  enterprise.[^edges]
- 276 subpath exports across the 35 module web packages: 183 `./surfaces/*`,
  71 flat, 15 bare root, 5 `./testing`, 2 `./screens/*`.[^exports]
- **84 oxlint `crossFeature` findings** (68 production, 16 test), reproduced
  exactly: scenario→suite 50, trace→presence 14, trace→annotation 6,
  workflow→agent 5, trace→share 4, scenario→agent 3, trace→suite 1,
  ops→feature-flag 1.[^findings]
- **26 `package-cycle` findings** from the enforcer's own `lintCycles`:
  **23 web cycles + 3 contract cycles**.[^cycles]
- **`boundary-edge-baseline.json`: 933 entries, every one expiring
  2026-10-01**, `enforceExpiry: true`, growth and postponement refused. 96 are
  `cross-feature` (78 of them web → web manifest edges — 74 in `modules/`, 4 in
  `enterprise/`) and 837 are `private-runtime-export`. 83 entries mention
  `-web`; the 5 that are not web → web edges match on `-webhook` /
  `lambda-web-adapter` substrings and are out of scope here.[^baseline]
- A baseline entry is deleted by making its violation stop firing: the stale-row
  check then **requires** deleting the row
  (`packages/architecture-enforcer/src/policies/boundaries/boundary-edge-baseline.ts`).
  Two mechanisms exist: remove the dependency edge, or make the pair derivable
  as a declared surface use (`declaredWebDependencyPairs`,
  `packages/architecture-enforcer/src/policies/frontend/frontend-ui-boundaries.ts:2292`).
  Today the second mechanism only works when a catalogue frontend feature's
  `root` equals the importing module's feature name — true for `analytics`,
  false for `scenario`/`trace`/`experiment`/`workflow` (their catalogue roots
  are `simulations`/`traces`/`experiments`/`workflows`) — which is why lane 1
  exists.

## 3. Corrections to the options doc, found while verifying

1. **`tech-stack` is not contract material.** §3.4 lists onboarding→project
   (`tech-stack`) among "types and constants"; the export's source is
   `modules/project/browser/src/ui/blocks/tech-stack.tsx` and onboarding imports
   the `TechStackSelector` **component**, which project-web also uses
   internally. The contract move is invalid; the edge stays (declared), and
   cycle 18 is broken elsewhere (lane 16).
2. **`batch-evaluation-state` and `evaluation-mappings` are not contract
   material either** — a component (`batch-evaluation-v2.tsx`) and a React hook
   (`use-evaluation-mappings.ts`). Dropped from the contract-move worklist;
   consequently prompt→experiment keeps one import and its baseline entry is
   cleared by declaration, not removal.
3. **"The three pure agent-editors functions alone delete workflow→agent" is
   wrong.** `modules/workflow/browser/src/behavior/agents/http/index.ts` also
   imports components (`OutputPathInput`, `TestMessagesBuilder`) from
   `agent-http-editor`. Retiring the edge needs the http-editor decision too
   (lane 4).
4. Small count drifts, none structural: 77 module web→web edges today (doc
   measured 75), 276 subpath exports (brief said 261), `lintCycles` reports 26
   (doc's own note; brief's 23 is the web subset — confirmed exactly).
5. suite-web's seventh non-surfaces export is `./testing` — a legal test seam
   that **stays**; only six entries rename. presence-web declares a bare root
   `.` export (not "no exports at all"); the substance — no named entries —
   holds.

## 4. Lanes

Sixteen lanes in three waves. Wave 1 creates (additive only — nothing breaks
mid-wave); wave 2 rewrites consumers and deletes originals; wave 3 is the
peer-gated trace work. Manifests: `.claude/manifests/web-<n>-<slug>.md`.
**Coordinator-owned, no lane touches them:** `apps/ui/src/features/catalogue.json`,
`packages/architecture-enforcer/src/boundary-edge-baseline.json`, the
declaration population (§6), and every cross-lane one-liner routed through
handoff §10.

| # | Lane | Model | Wave | Owns (summary; exact globs in manifest) | Does | Check | ~Files | Blocked by / blocks |
|---|------|-------|------|------|------|-------|--------|---------------------|
| 1 | web-1-declaration-seam | opus | 1 | `packages/architecture-enforcer/**`, `packages/oxlint-rules/**`, their specs, ADR-004 amendment | Per-module `feature.json` web `uses` declaration; `declaredWebDependencyPairs` (and the oxlint rule's declared-dependency door) read it; boundary-edge violations stop firing for declared surface pairs, enterprise included | enforcer + oxlint-rules package unit tests | ~14 | blocks declaration population (§6) |
| 2 | web-2-shared-homes | opus | 1 | `packages/browser-trpc/**` (new), named new files in `packages/design-system`, `packages/handled-error`, `packages/ui-host` | Creates `@langwatch/browser-trpc` (`./workflow-api`, `./agent-client`), design-system `./period-selector` `./markdown` `./isolated-error-boundary` `./copy-button` `./copy-icon`, handled-error `./views`, ui-host `./feature-flag` — copies, originals untouched | each target package's test:unit + typecheck:one | ~22 | blocks 7,8,9,10,11,12,13,14,15 |
| 3 | web-3-contract-moves | opus | 1 | `modules/{evaluator,prompt,experiment,dataset}/contract/**` | Adds `evaluation-types`→evaluator-contract, `llm-config-constants`→prompt-contract, `workbench-types`+`mapping-validation`→experiment-contract, `studio-dataset-columns` model→dataset-contract; each move direction-checked against the 3 live contract cycles | the four contract packages' test:unit + typecheck:one | ~10 | blocks 8,9,10,11,12,13 |
| 4 | web-4-agent-contract | opus | 1 | `modules/agent/contract/**`, `modules/agent/browser/**` | `buildCodeConfig`/`DEFAULT_CODE`/`getCodeFromConfig`, `messagesToJson` + message types → agent-contract; decides the http-editor component ownership; writes the workflow-side rewrite recipe; batch B retires `agent-client` after 7 and 15 collect | agent contract+web test:unit, typecheck:one | ~8 | blocks 8; batch B after 7, 15 |
| 5 | web-5-flat-outliers | sonnet | 1 | `modules/feature-flag/browser/package.json`, `modules/ops/browser/**`, `modules/organization/browser/package.json`, one named annotation-web src file, two named apps/ui files | `feature-flag-web ./experiment-catalogue` and `organization-web ./personal-workspace-features` → `./surfaces/*`; rewrites their 4 import sites | per-file lint + ops/organization test:unit | ~7 | — |
| 6 | web-6-coding-agent-drawer | sonnet | 1 | `modules/coding-agent/browser/**` | Replaces the `trace-drawer-store` import with drawer-registry open-by-name; deletes the trace-web dependency | coding-agent-web test:unit, typecheck:one | ~3 | — |
| 7 | web-7-scenario-suite | sonnet | 2 | `modules/scenario/browser/**` (minus the media-part carve-out), `modules/suite/browser/package.json` | suite's 6 entries gain `./surfaces/*` keys; scenario's 50 suite imports, 3 agent-client, 27 period-selector and 1 copy-button imports rewritten; 5 flat suite keys deleted (`./run-formatters` kept for trace, deleted via lane 16 handoff) | scenario-web + suite-web test:unit, typecheck:one | ~45 | blocked by 2 |
| 8 | web-8-workflow | sonnet | 2 | `modules/workflow/browser/**` | Deletes moved-out sources + export keys (workflow-api, feature-flag, markdown, isolated-error-boundary, copy-button, handled-error-views); rewrites own workbench-types imports; executes lane 4's agent recipe; drops the agent-web dep | workflow-web test:unit, typecheck:one | ~18 | batch A blocked by 2,3,4; deletion batch after 7,9,10,11,12,13,14,15 |
| 9 | web-9-evaluator | sonnet | 2 | `modules/evaluator/browser/**` | Rewrites workflow-api (13), handled-error-views, feature-flag, period-selector, workbench-types, mapping-validation; adopts `comparison-config-form` + `evaluator-editor-callbacks` from experiment (copies in); deletes evaluation-types original after consumers move; drops experiment-web dep | evaluator-web test:unit, typecheck:one | ~25 | blocked by 2,3 |
| 10 | web-10-experiment | sonnet | 2 | `modules/experiment/browser/**` | Rewrites workflow-api (32), feature-flag, handled-error-views, copy-icon; internal rewrites to experiment-contract types and to evaluator's adopted surfaces; deletes moved-out originals; drops model-provider-web dep | experiment-web test:unit, typecheck:one | ~45 | blocked by 2,3; deletion batch after 9,11 |
| 11 | web-11-prompt | sonnet | 2 | `modules/prompt/browser/**` | Rewrites workflow-api (7), workbench-types + mapping-validation → experiment-contract; deletes llm-config-constants original after lane 13 | prompt-web test:unit, typecheck:one | ~13 | blocked by 2,3 |
| 12 | web-12-dataset | sonnet | 2 | `modules/dataset/browser/**` | Rewrites workflow-api (7), copy-button, studio-dataset-columns → dataset-contract; **drops the workflow-web dep** | dataset-web test:unit, typecheck:one | ~12 | blocked by 2,3 |
| 13 | web-13-analytics-model-provider | sonnet | 2 | `modules/analytics/browser/**`, `modules/model-provider/browser/**` | analytics: workflow-api + feature-flag rewrites, evaluation-types → evaluator-contract, deletes period-selector original; **drops workflow-web and evaluator-web deps**. model-provider: workflow-api + feature-flag + handled-error-views rewrites, llm-config-constants → prompt-contract, deletes copy-icon original; **drops workflow-web and prompt-web deps** | both packages test:unit, typecheck:one | ~14 | blocked by 2,3 |
| 14 | web-14-langy-project | sonnet | 2 | `modules/langy/browser/**`, `modules/project/browser/**` | langy: markdown + isolated-error-boundary → design-system, 12 `vi.mock("…workflow-api")` strings retargeted; **drops workflow-web dep**. project: period-selector rewrite | langy-web + project-web test:unit, typecheck:one | ~17 | blocked by 2 |
| 15 | web-15-apps-ui-clients | sonnet | 2 | named `apps/ui/src/features/{agent,simulations}` files | agent-client and workflow-api imports → `@langwatch/browser-trpc` | ui test:unit scoped to the named files, per-file lint | ~12 | blocked by 2 |
| 16 | web-16-trace-cutover | **opus** | 3 | `modules/trace/browser/**`, `modules/presence/browser/**`, `modules/share/browser/**`, `modules/annotation/browser/package.json`, `modules/scenario/contract/**` | **BLOCKED ON PEER — another session owns `modules/trace`; this lane must not start until the coordinator confirms the peer has finished and committed.** Rewrites trace's 25 pre-convention imports (presence 14 → named new presence surfaces, annotation 6, share 4, suite 1); presence/share/annotation gain surface keys, flat keys and presence root retired; kills trace→langy (registration inversion, trace-side); kills trace→scenario (media-part model → scenario-contract if model-only — else declare); decides cycle 18's break (§5); dedups trace's isolated-error-boundary | trace/presence/share test:unit, typecheck:one each | ~38 | blocked by peer + 2,3,7 |

Wave 2's "deletion batches" (lanes 8, 10, 11) run as each lane's second batch,
after the coordinator confirms the consumer lanes collected — the two-batch
pattern `cv2-port-word.md` established. No two lanes own the same file; every
cross-lane one-line edit (suite's `./run-formatters` key, workflow's
`src/index.ts:48` re-export line, langy rewrite lines if lane 16 chooses the
langy→trace break) travels through handoff §10 to the coordinator.

## 5. The 23 web cycles, mapped

Every cycle `lintCycles` reports today, with the edge a lane deletes.
(The 3 contract cycles are out of scope — §7. Edge deletions were verified
against the full per-edge import inventory.[^inventory])

| # | Cycle (as reported) | Broken by deleting | Lane(s) |
|---|---------------------|--------------------|---------|
| 1 | agent → scenario → agent | scenario→agent (`agent-client` → api-client-web) | 2 + 7 |
| 2 | agent → scenario → analytics → evaluator → experiment → dataset → workflow → agent | scenario→analytics; also workflow→agent, dataset→workflow, analytics→evaluator | 7 (+ 8, 12, 13) |
| 3 | analytics → evaluator → analytics | analytics→evaluator (`evaluation-types` → contract) | 3 + 13 |
| 4 | analytics → evaluator → experiment → dataset → workflow → model-provider → prompt → onboarding → project → analytics | analytics→evaluator; also model-provider→prompt, dataset→workflow | 3 + 13 |
| 5 | dataset → workflow → dataset | dataset→workflow (workflow-api + copy-button + studio-dataset-columns) | 2 + 3 + 12 |
| 6 | dataset → workflow → model-provider → prompt → dataset | dataset→workflow; also model-provider→prompt | 12 (+ 13) |
| 7 | dataset → workflow → model-provider → prompt → onboarding → project → langy → trace → dataset | dataset→workflow | 12 |
| 8 | evaluator → experiment → dataset → workflow → evaluator | dataset→workflow; also evaluator→experiment | 12 (+ 9) |
| 9 | evaluator → experiment → dataset → workflow → model-provider → prompt → onboarding → project → langy → trace → evaluator | dataset→workflow; also evaluator→experiment, model-provider→prompt | 12 (+ 9, 13) |
| 10 | evaluator → experiment → evaluator | evaluator→experiment (workbench-types + mapping-validation → contract; comparison-config-form + evaluator-editor-callbacks adopted by evaluator) | 3 + 9 |
| 11 | experiment → dataset → workflow → experiment | dataset→workflow | 12 |
| 12 | experiment → dataset → workflow → model-provider → prompt → experiment | dataset→workflow; also model-provider→prompt | 12 (+ 13) |
| 13 | langy → trace → langy | trace→langy (registration inversion, trace side) | 16 |
| 14 | model-provider → prompt → model-provider | model-provider→prompt (`llm-config-constants` → contract) | 3 + 13 |
| 15 | model-provider → prompt → onboarding → model-provider | model-provider→prompt | 3 + 13 |
| 16 | model-provider → prompt → onboarding → project → langy → model-provider | model-provider→prompt | 3 + 13 |
| 17 | model-provider → prompt → onboarding → project → langy → trace → model-provider | model-provider→prompt | 3 + 13 |
| 18 | onboarding → project → langy → trace → onboarding | lane 16 decides: move trace's onboarding-composed setup screens into onboarding-web (kills trace→onboarding), or trace-domain models → trace-contract (kills langy→trace; langy rewrite lines via coordinator). The cheap break (onboarding→project) is invalid — §3.1 | 16 |
| 19 | scenario → analytics → evaluator → experiment → dataset → workflow → model-provider → prompt → onboarding → project → langy → trace → scenario | scenario→analytics; also trace→scenario | 7 (+ 16) |
| 20 | trace → coding-agent → trace | coding-agent→trace (drawer registry open-by-name) | 6 |
| 21 | workflow → model-provider → prompt → onboarding → project → langy → workflow | langy→workflow (markdown + isolated-error-boundary → design-system); also model-provider→prompt | 14 (+ 3, 13) |
| 22 | workflow → model-provider → prompt → workflow | model-provider→prompt | 3 + 13 |
| 23 | workflow → model-provider → workflow | model-provider→workflow (workflow-api + feature-flag + handled-error-views) | 2 + 13 |

**Honesty about re-sampling:** `lintCycles` is a DFS sample over one SCC. When
these edges die, the DFS will surface residual studio-core cycles the current
sample shadows — `workflow ↔ prompt` and `workflow ↔ experiment` are mutual
pairs today and survive this pass. That residue is deliberate (§7); the
enforcer keeps reporting it, and the follow-up drive inherits the options doc's
§3.2 worklist with the declared layer order: model-provider and dataset below
prompt, prompt below workflow, workflow below experiment/evaluator screens.

## 6. Baseline-entry accounting

The register holds **933 entries, all expiring 2026-10-01** (16 days). This
migration owns the **78 web → web `cross-feature` entries**. Two clearing
mechanisms:

**Deleted by removing the dependency edge (12 firm before the deadline):**

| Lane | Entries deleted |
|------|-----------------|
| 6 | coding-agent→trace (1) |
| 7 | scenario→agent-web, scenario→analytics-web (2) |
| 8 | workflow→agent-web (1) |
| 9 | evaluator→experiment-web (1) |
| 10 | experiment→model-provider-web (1) |
| 12 | dataset→workflow-web (1) |
| 13 | analytics→workflow-web, analytics→evaluator-web, model-provider→workflow-web, model-provider→prompt-web (4) |
| 14 | langy→workflow-web (1) |
| 16 | trace→langy-web, trace→scenario-web (up to 2 — peer-gated, may land late; covered by declaration meanwhile) |

**Cleared by the declaration seam (the remaining 66):** once lane 1 lands, the
coordinator populates the per-module declarations from the measured edge
table[^inventory] for every surviving legal surface edge — including the 4
enterprise entries and, as a stopgap, any lane-16 edge the peer schedule
delays. Every declared pair's `cross-feature` violation stops firing; the
stale-row check then forces the rows out. 12 + 66 = 78. (One suspected
freebie: `enterprise/modules/billing/browser → workflow-web` has no matching
import in enterprise source — likely a stale dependency the coordinator can
drop outright.)

**Critical path for the deadline: lane 1 → declaration population → baseline
sweep.** Lane 1 must land within the first week. Every other lane improves the
graph but is not deadline-load-bearing.

**The remainder, stated plainly.** 855 entries — 18 `cross-feature`
server → server edges and 837 `private-runtime-export` rows — are **not
web-boundary work and no lane in this plan touches them**. They expire on the
same date. Even with all sixteen lanes green, CI fails on 2026-10-01 unless
they are cleared. Postponement is refused and will not be proposed. What must
happen instead: the coordinator commissions the two missing drives **this
week** — (a) a private-runtime-export drive, mechanical per-module index-export
sweeps that parallelise exactly like wave 2 here (837 rows across ~40 server
packages), and (b) a server cross-feature drive closing 18 edges behind ports
and contracts. If the owners judge 16 days genuinely insufficient for (a)+(b),
the coherent move is the options doc's §4E honesty applied by the enforcer's
owners — change the policy deliberately (e.g., split `private-runtime-export`
into its own register with its own reviewed dates **at creation**, which is a
new policy decision, not a postponement of this one) — an explicit decision,
not an expiry. This plan flags the fork; it does not own it.

## 7. Deliberately not in this pass

- **Full studio acyclicity.** workflow↔prompt and workflow↔experiment mutual
  embedding survives (~30 residual imports); needs the declared layer order
  above and product-level ownership moves. Follow-up drive.
- **The 3 contract cycles** (`scenario ↔ suite`, the evaluation ring, the
  scenario/automation ring). Lane 3 direction-checks against them and must not
  worsen them; fixing them is separate work.
- **Hub thinning that deletes no edge and clears no row**: keyboard-key,
  format-money, hoverable-big-text, render-code, fetch-sse, sse-subscription
  and the rest of workflow-web's generic freight. Worth doing later; noise now.
- **B2 cluster parts packages** — declined, per the options doc.
- **Host-install-tier entries stay flat**: `annotations`, `annotation-scores`,
  `agent-management`, `connected-agents`, `organization-client`, `./drawers`,
  `./testing` — apps/ui-only doors are the private tier working as designed.
- **Surface-closure purity.** Stores ship as surfaces today (langy-store,
  trace-drawer-store); this plan follows current practice and does not attempt
  to resurrect ADR-004's closure rules.
- **A new lint tier.** No rule changes beyond lane 1's declaration seam; the
  cycle ratchet comes after the SCC shrinks.

## 8. Peer conflict, restated

Another Claude session is actively editing `modules/trace`. **No lane except
lane 16 may touch `modules/trace/**`, and lane 16 starts only when the
coordinator confirms the peer is done.** Until then trace's 25 findings and its
baseline entries are carried by the declaration seam, and suite-web keeps its
one dual `./run-formatters` key. The current checkout also carries uncommitted
work under `modules/project/process/**` — web lanes have no business there, and
none owns it.

---

[^pkgs]: `ls modules/*/web/package.json | wc -l` → 35; `ls enterprise/modules/*/web/package.json | wc -l` → 6.
[^edges]: For each `modules/*/web/package.json`, count `dependencies`+`devDependencies` matching `@langwatch/*-web`: 77 (enterprise: 7). One-liner: `python3 -c "import json,glob;print(sum(1 for p in glob.glob('modules/*/web/package.json') for d in {**json.load(open(p)).get('dependencies',{}),**json.load(open(p)).get('devDependencies',{})} if d.startswith('@langwatch/') and d.endswith('-web')))"`.
[^exports]: Same iteration over `exports` keys, bucketed by prefix: 276 total = 183 `./surfaces/` + 71 flat + 15 `.` + 5 `./testing` + 2 `./screens/`.
[^findings]: Simulate the rule over `modules/*/web/src`: collect `@langwatch/*-web` import specifiers, drop same-feature, `./surfaces/[^/]+`, catalogue-declared (`root:specifier`), and `./testing`-from-recognized-test; 84 remain, per-edge counts as listed. The simulation script is reproduced in the coordinator handoff; it matches the options doc §2 table exactly.
[^cycles]: `cd packages/architecture-enforcer && node --disable-warning=ExperimentalWarning --experimental-transform-types -e "import('./src/workspace/snapshot.ts').then(async s=>{const c=await import('./src/policies/boundaries/cycles.ts');for(const v of c.lintCycles(s.buildWorkspaceSnapshot({root:'../..'})))console.log(v.message)})"` → 26 lines, 3 naming `-contract` packages.
[^baseline]: `python3 -c "import json;d=json.load(open('packages/architecture-enforcer/src/boundary-edge-baseline.json'));e=d['entries'];print(len(e),sum(1 for x in e if x['expires']=='2026-10-01'),sum(1 for x in e if '-web' in x['key']),sum(1 for x in e if '/web/package.json' in x['key'] and x['key'].split('|')[-1].endswith('-web')))"` → `933 933 83 78`.
[^inventory]: Group every `@langwatch/*-web` import in `modules/*/web/src` by (importing feature, target feature, subpath). The full table is in the coordinator handoff; headline rows: workflow-api imported 66× from 6 packages, period-selector 27× from scenario, suite entries 50× from scenario, presence root 14× from trace.
