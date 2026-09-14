# apidiff's first behavioural report — 2026-09-14

The objective stated in `handover-2026-09-12-apidiff.md` is reached: `apidiff
run` completed a full lockstep probe and exited **1 — differences found**. We
had never before gotten past exit 2. Run artifacts (gitignored, keep locally):

    .apidiff/report-20260914-r2.json     # 5.7 MB machine report
    .apidiff/ledger-20260914-r2.json     # the worklist, grouped by root cause
    .apidiff/20260914-191108/            # work root, findings.jsonl stream

Command, from repo root (rebuild the binary first if the tool changed):

    go build -o .bin/apidiff/apidiff ./cmd/apidiff
    .bin/apidiff/apidiff run -no-haven -main-ref origin/main -json \
      -report .apidiff/report-<date>.json -ledger .apidiff/ledger-<date>.json

Ratchet from here with `-ledger-baseline .apidiff/ledger-20260914-r2.json`:
only a NEW cause fails the run while the 21 known ones are worked down.

## What unblocked it

1. `b6166254aa` (sibling session) bound the six process facts on the REST
   host — the previous run died at the `unsubscribeCallerAddress` mount.
2. `4da83a8394` (this session) restored the discovery locations. The
   `api-shell-dead-code` sweep (`0190d5d84c`) had deleted the five discovery
   routers as orphaned; they were unreferenced only because `b383462d96` lost
   their mount. They are back as a process-owned Hono app
   (`apps/api/src/features/discovery/discovery.app.ts`, SSE-lane shape),
   serving `/api/openapi.json`, its `/api/v1` twin,
   `/api/gateway/v1/openapi.json`, `/.well-known/openapi` and `/llms.txt`
   from one byte buffer, policies registered. apidiff's spec fetch was 404ing
   on exactly that.

## The numbers

336 union operations · 154 probed · 158 skipped · 100 differing ·
21 root causes, all new. Caveat: the branch instance boots in place, so it
carried the checkout's in-flight uncommitted edits at run time.

## Standing triage rule (user direction, 2026-09-14)

Where main answered an error and the branch answers a **HandledError** —
a clean, named refusal — that is an improvement to KEEP and baseline
(apidiff's slug for the direction is `server-error-resolved:*`; same-class
4xx differences are suppressed by default already). Never fix the branch
back to main's error behavior. The bad direction is unchanged:
`handled-refusal-degraded:*` (main refused cleanly, branch 500s) is always
a real defect.

## Triage, most severe first

1. **Owner-key 2xx→5xx (15 ops)** — `status-class-mismatch:200-500` +
   `:201-500`. Main serves, branch 500s: GET /api/experiments, /api/groups,
   /api/me/project, /api/model-defaults, /api/model-providers,
   /api/organization (+invites/members, PATCH), /api/projects,
   /api/webhooks/v1/{endpoints,event-types}, PUT /api/model-providers/{p},
   POST /api/dataset, POST /api/groups. Real regressions; read each op's row
   in the report for the response captured.
2. **Refusals degraded to 500 (20 ops)** — `handled-refusal-degraded:*`.
   Main answers a clean 4xx, branch 500s: prompts (4), analytics
   dashboard-widgets (2), query (2), role-bindings (2), test-suites (2),
   experiments family (3), scenarios, simulation-runs, dspy/log_steps,
   organization/invites, me/usage. Matches the handover's prediction that
   recorded refusals and half-converted modules would surface here.
3. **401→200 (8 ops)** — main refuses the probe's credential, branch accepts:
   GET run-plans/scenarios/secrets/suites/triggers/workflows,
   POST /api/traces/search, POST /api/trigger/slack. Decide per op whether
   the branch fixed a door or opened one — /api/secrets first.
4. **Missing on branch (34 ops)** — `operation-missing-on-candidate`:
   scim/v2 family (7), projects/{id} family (5), governance
   ingestion-templates (4), langy/control (4), scenario-events (3), dataset
   uploads (2), teams (2), events/track + track_event, trace/search, `/`.
   Overlaps `unserved-documented-operations-2026-09-14.md` — same worklist.
5. **Shape/value diffs (3 ops)** — GET /api/evaluations/list,
   /api/roles/permissions (shape); GET /api/organizations (value).
6. **Permission diffs (2 ops)** — governance/ingestion-templates and `/`
   answer foreign keys differently. No `permission-leak` findings at all.
7. **Coverage debt, harness-side** — 117 `unresolvable-parameter` +
   41 `harness-symbol-table` skips: most mutations that would mint IDs are
   themselves failing (class 1/2), so reads depending on captured IDs skip.
   Fixing classes 1–2 will raise probed coverage on its own.

20 `operation-missing-on-base` ops are branch-only additions (admin
impersonation, gateway virtual keys, langy conversations…) — expected.
The 349 `spec-*` rows are document-level drift context, not probes.

## Run 5 (2026-09-14, retest against the run-2 baseline)

Invoked from a clean detached worktree (`.claude/worktrees/apidiff-branch`,
HEAD a8c43d2f11) after two boot gates fell: run 3 hit an uncommitted mid-port
langy export in the shared checkout (not repaired — the rest-chain-port lane
owns it; the clean worktree sidesteps it), run 4 exposed a real fresh-checkout
defect (mail's tsc checked ksuid's vendored source because nothing had built
ksuid's `dist`; fixed in ensure-built as 9a03ec7015). Exit 1: 17 of the 21
baselined causes remain, 6 new. Report/ledger: `.apidiff/{report,ledger}-20260914-r5.json`.

**Cleared by the fix wave** (seven collected lanes + the door/config seams):
`handled-refusal-degraded:400-500`, `:422-500`, `status-class-mismatch:201-500`
and `permission-diff:404-200` are gone entirely; `401-500` shrank 16→5 ops
(prompts ×4, role-bindings ×2, test-suites ×2, dspy, experiment/init all
fixed); `200-500` shrank 13→3 (experiments, me/project, groups,
organization ×4, model-defaults, model-providers ×2 all answer now).

**Still crashing, attributed:**
- Webhooks ×2 (200→500): `#dependencies.assertEndpointsEntitled is not a
  function` — webhook module never got its members (b383462d96 family).
  Lane `webhook-members-green` spawned.
- POST /api/scenarios (401→500): strict `scenarioSchema.parse(row)` rejects
  the `callerVoice` COLUMN the module rewrite never learned — every scenario
  create/read on a non-empty database crashes; empty seeds masked it.
  Lane `scenario-callervoice-green` spawned.
- GET /api/projects (200→500): known parked `app.apiKeys()` operations-only
  proxy defect — lint session's flight path.
- Analytics family ×4 (401→500): parked, debt-5 lane territory.

**New causes, triaged:**
- `status-class-mismatch:200-402` ×5 + `:201-402` ×1 (groups, organization
  family): the entitlement module now answers `enterprise_plan_required`
  (feature MANAGEMENT_API) where main served the same key 200. These ops
  moved out of the crash class — the fix wave worked — into a deliberate
  Enterprise gate the apidiff seed org fails. This is the queued
  EntitlementApi tier-override product decision: decide whether self-hosted /
  non-SaaS grants MANAGEMENT_API by default before baselining.
- `handled-refusal-degraded:401-503` (GET /api/simulation-runs): the named
  `ScenarioSimulationsUnavailableError` refusal the scenario lanes installed
  on purpose — the `simulations` member is blocked on the ClickHouse client
  shape mismatch (scenario-composition-green-2 handoff, Risk #3). Baseline
  until that adapter lands.
- `permission-leak` ×2 (model-defaults, model-providers): restricted keys
  key-b/key-c see system entities (`system_anthropic`,
  `local-dev-model-default-config`) that main's 200 hides. Secrets are
  redacted (`customKeys: null`); the leak is entity visibility. Model-provider
  follow-up to decide filter-vs-intended.
- `status-class-mismatch:401-201` ×2 (POST prompts/tags, POST test-suites):
  the intended key-authenticated publication class — these are the fixes
  succeeding where main refuses the credential.
- `mutation-not-visible` (GET /api/model-providers): derivative of the
  intended 401→200 publication — main 401s the read, so the created entity
  can never appear on that side. Benign.
