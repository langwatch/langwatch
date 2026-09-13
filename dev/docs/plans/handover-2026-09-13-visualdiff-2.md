# Drive: visualdiff report against `origin/main` — coordinator handover 2

Written 2026-09-13 evening, replacing `handover-2026-09-13-visualdiff.md` as
the ENTRY POINT for the visualdiff/worker drive. That file and
`handover-2026-09-13-apidiff-2.md` (the api-side twin, also a fresh-coordinator
entry point) are the background reading; this file is what you act on.

Branch `feat/strict-feature-layout-v0`. Run `bash
dev/scripts/coordinator-state.sh --full` before trusting anything here.

## LIVE ITEMS — read these before anything else

1. **One lane is ACTIVE: `module-v2-workflow`** (sonnet, owns
   `modules/workflow/server/src/**`; manifest
   `.claude/manifests/module-v2-workflow.md`, roster row in
   `.claude/coordinator/LANES.md`). It converts `WorkflowApp` to
   reads()/dependencies with `evaluators` as a dependency token, enabling
   workflowServer + evaluatorServer to install in ONE `createApp` (the
   framework's lazy API clients resolve their mutual dependency; a two-app
   split cannot). It was spawned from THIS session, so its completion
   notification dies with the session — **check
   `.claude/handoffs/module-v2-workflow.md` on disk** — **UPDATE, minutes
   before this session ended: the lane FINISHED, status `partial`, and that
   handoff now EXISTS — it is your collection input, not a salvage.** The
   short version: the manifest's four named collaborators (evaluators token,
   modelProviders→studioDsl, agents→agentMappings, prisma→workflowRows) are
   converted per the deleted-composition recipe; its package.json gained the
   infrastructure dep AFTER the freeze lifted, so the ANNOUNCED `pnpm
   install` at collection is REQUIRED before its tests can even link (23
   files currently fail on `Cannot find package
   '@langwatch/infrastructure/members'` — expected, clears with install).
   §10 has the exact new `WorkflowApp.create` shape for
   worker-agent-apps.composition.ts. §11 item 1 is an OPUS-GRADE decision
   the lane rightly refused to guess: ~24 remaining `WorkflowHostMembers`
   fields (permissions, lineage, publications, evaluations, nlpLambda*, …)
   have NO existing adapters anywhere and the framework's
   `withInfrastructure` escape hatch is gone — decide their seam (or a
   staged subset) before any lane touches them; security- and data-relevant.
   The lane rewrites it
   before stopping, whatever happens. If the handoff shows no update and no
   lane output for ~20 minutes, treat it as dead and salvage from the working
   tree (`git status modules/workflow`). It may add
   `@langwatch/infrastructure` to `modules/workflow/server/package.json` (the
   precedented line) — that means one ANNOUNCED `pnpm install` at collection
   (protocol below).
2. **The worker's ONE remaining boot wall** (verified twice, solo boot and
   haven stack): `MissingProviderError: Feature "evaluator" declares
   dependency "workflows" on workflow, and no installed feature provides it`,
   from the worker's agent graph. The fix, ready to apply once the workflow
   lane lands: in `apps/worker/src/app/worker-agent-apps.composition.ts`,
   replace the direct `WorkflowApp.create({members: {...}})` call and the
   separate `installWorkerEvaluator` app with ONE `createApp` installing
   `[workflowServer, evaluatorServer]` (plus the withProvided peers each
   needs); `installWorkerEvaluator`'s `workflows: WorkflowService` /
   `nlpRuntime` params are the dead half of that seam — the evaluator lane's
   handoff `.claude/handoffs/evaluator-composition-green.md` §10 has the
   exact wanted shape, and `worker-production.composition.ts:1265` has the
   second call site. These are coordinator-owned files; no lane owns them.
3. **The apidiff side has a fresh coordinator too** (session name `apidiff`
   on the channel). Its clean run `20260913-182700` died at branch boot on an
   `await createProcess(` in a non-async function at
   `api-production.composition.ts:360`; it is fixing that and relaunching.
   Coordinate over SendMessage as before.
4. **Verification method — solo boots, NOT the haven backend lane.**
   `tools/dev-runtime`'s backend entrypoint SWALLOWS worker boot rejections
   (members closed, no fatal logged, process lingers — reproduced twice; an
   unfixed defect worth a slice of its own). Use:

       bash -c 'eval "$(haven env --reveal)"; pnpm --filter @langwatch/worker start' 2>&1 | head -80

   A haven stack for this worktree is up (slug
   `feat-strict-feature-layout-v0`; `haven down` if you want it gone). Note
   `.env` gained `HAVEN_PG_FORMULA=postgresql@14`, and the brew postgres
   needed `CREATE ROLE lw SUPERUSER LOGIN` (its datadir predates the
   machine's afr→lw user rename) — both already done, recorded so a fresh
   machine hiccup is recognisable.

## Exact next actions, in order

1. Collect `module-v2-workflow` (review → announced install if package.json
   changed → commit by pathspec via `dev/scripts/commit-slice.sh` → clear the
   roster row).
2. Apply live item 2 (the one-app workflow+evaluator install) in the two
   coordinator files; delete what `installWorkerEvaluator` no longer needs
   rather than keeping a pass-through.
3. Solo boot. Expected outcomes in order of likelihood: (a) the worker walks
   to its healthz/metrics listener with transports on the closed doors —
   DONE; (b) a new module-named refusal — same loop as ever: claim on the
   channel, convert or hand to apidiff; (c) a WorkflowApi↔EvaluatorApi wrinkle
   the one-app install did not absorb — the evaluator handoff §11 flagged it,
   boot will name it.
4. When BOTH the worker boots and apidiff's api answers health (their clean
   run reaching probe phase is the signal), run:

       .bin/visualdiff/visualdiff run -keep -agent -boot-timeout 40m

   from the repo root (rebuild first if tools/visualdiff changed: `go build
   -o .bin/visualdiff/visualdiff ./cmd/visualdiff`). Prep is PROVEN green
   through ensure-built on fresh worktrees (78c6e2ca5b fixed the last prep
   wall). `-keep` leaves both stacks up for the recapture loop
   (`tools/visualdiff/README.md`, "Findings stream and recapture").
5. Triage findings against `dev/docs/plans/route-surface-parity-2026-09-12.md`
   — sixteen addresses redirect BY DESIGN and will classify `changed`; the
   four `/governance/*` 404s are already in visualdiff.yaml as real gaps.

## What landed today (this drive's slices, newest first)

    45601c2c3d  dataset: optional storage tokens with named refusals; ksuid record ids
    9cc2085bf5  suite call-site clickhouse member; two direct-create {infrastructure:}→{members:}
    94f635a613  agent-family mini-apps v2; feature-flag config slice = parsed record (real bug fixed)
    f692ad1dc4  dashboard onto AnalyticsApi workbench surface (silent set COMPLETE)
    e87444e69e  workerClosedDoors(): declared transports mount on closed doors, refuse by role
    8621b412bd  scenario-execution + observability mini-apps v2
    418f69ddae  evaluation-family mini-apps v2 (named monitor/evaluator/dataset for the queue)
    a24a63479f  langy conversion + PresenceBroadcastFabric peer token (2 consumers: langy, trace)
    fd05332478  topic conversion (cured the api role's fake "not scheduled")
    69a8eb70ac  feature-flag conversion + voiceAgents contract fix
    019d94914d  worker foundation on the v2 builder; four installers deleted (−1064 lines)
    a36bd947f8  enterprise composition links (3 renames + 2 type-only re-exports)
    324ac2c9e2  {tier, members} selection sweep + both audit-log boot(config) fixes
    64af8f1446  ops/usage-stats seam; routingDriver → @langwatch/clickhouse-client
    eddbdfe58d  47 worker erased-extends sites
    78c6e2ca5b  rest addressing helpers generic (visualdiff fresh-worktree prep wall)

apidiff-side landings are in THEIR handover; the interleaved hashes that
matter here: monitor 5db2246288, evaluator 932722a5df, workbench surface
591178f57a, tRPC door 1980456999, organization d9b888e858, ops 2c2dbc6528,
identity 6a7c671691, ksuid migration 23cb2058ce.

## Standing protocols (all three sessions, unchanged)

- **Claim-first per module** on the cross-session channel before touching any
  `modules/*/server` outside your roster.
- **Announce every `pnpm install`** on the channel before running (shared
  node_modules; their measurement runs need lockfile-stable windows —
  freezes are requested and honored both ways).
- **Commit by explicit pathspec** via `dev/scripts/commit-slice.sh`, never
  `git add .` — three sessions share this working tree.
- Lanes: manifest before spawn, roster row before the Agent call, model
  passed explicitly, collect via summary→handoff §8/9/10→diff, clear the row.

## Known deferred items (recorded, unowned unless stated)

- dev-runtime swallows worker boot rejections (live item 4) — fix = propagate
  or log+exit in the backend entrypoint.
- `codex-coding-defaults.integration.test.ts` imports the deleted tenancy
  installers and fails loudly at collection — rework against
  createWorkerFoundationApps once boots are green.
- langy: `relay` needs a public-base-URL config field; `uiActionSurface`
  fail-closed pending a FeatureFlagApi peer (handoff module-v2-langy §11/§12).
- The api's `apiModuleConfig` has no "feature-flag" slice — force-enable is
  inert there until someone adds
  `"feature-flag": resolveFeatureFlagConfig(<env source>)` (apidiff knows).
- organization invitations/joinRequests: doors refuse by name; the builders
  died with b383462d96 and have no owner (apidiff's probe will name them).
- Enterprise `*TrpcApi` orphans (14 symbols) stay PARKED behind the
  enterprise-tier wiring decision — a user/coordinator call, not a lane's.
- Two committed merge-conflict-marker files in
  modules/analytics/server/src/langwatch-ql/provisioning/__tests__/.
- Pre-existing typecheck baseline breaks: modules/scenario/contract (67,
  dangling `~/` imports), packages/test-harness (buttonWeightScan,
  test-logger) — they block typecheck:one for dependents; lanes baseline
  around them.
- The applications' tsc has still effectively never run end-to-end (the
  declarations short-circuit, first handover's "3 → 134 trap") — expect a
  large unhidden count when someone fixes the chain; it is unmasking, not
  regression.
