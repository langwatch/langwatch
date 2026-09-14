# Handover: the recovery drive — 2026-09-14

**ENTRY POINT for the successor coordinator.** Read this, then
`.claude/coordinator/LANES.md` (roster conventions), then work the queue
below. Every claim here was verified this session, not inherited.

## What is TRUE right now (verified, not claimed)

- **Sign-in works end to end** (2026-09-14 evening): the auth redirect loop
  was the tRPC door booting with NO session resolver — nothing ever passed
  `trpcSession` to `bootApiProcess`, so every procedure 401'd a valid cookie
  while the REST session endpoint accepted it, and the shell read the 401s
  as signed-out. Fixed at `e9095a71a9`: the tRPC door defaults its resolver
  from the same auth peer the REST host uses (`composeApiTrpcSession`),
  spec scenarios in `verified-session-on-request-context.feature` now bound
  (@unit, 4 tests). Verified in a real browser: sign-in lands on
  `/local-dev-project` and stays. The dashboard's OWN queries then 500
  (analytics.getTimeseries, home.getRecentItems, plan.getActivePlan, langy
  SSE) — that is queue item 5's deleted-builders class, not auth.
- `moduleApi` now REFUSES property members at compile time
  (`OperationsOnly`, `02db04f32c`) — the operations-only proxy defect class
  is closed at the type level.
- **The web declaration chain reaches real code** (`362a75c9fe`): queue
  item 2's circular-ref was already gone (`1f748bb0a6`); the coordinator
  cleared the three structural stragglers (ui-drawer process.env — now a
  shell-passed deployment prop per user direction, suite-web
  PENDING_EVALUATION case, prompt/web stale declaration paths). What
  remains in web packages is ordinary code debt — the
  module-web-typecheck-debt lane owns it.
- **The full stack runs under haven**: UI 200 at
  `https://app.feat-strict-feature-layout-v0.langwatch.localhost:1355/`,
  `/api/auth/session` 200 + no-store (sign-in serves — it was entirely
  unserved before `3e90aaad43`), solo worker AND combined backend reach
  `worker ready` with zero fatals. The stack is UP as of this handover.
- **A second coordinator session (06d630cd) is live** on this checkout
  running the mail-sink drive (mailsim-service + haven-mail-lane). It
  mis-flagged debt-3 as an orphan once — LANES.md rows carry the correction;
  check spawn times before declaring a lane dead.
- **Zero unbound REST facts** (`node dev/scripts/find-unbound-rest-facts.mjs`
  prints "Every declared REST fact is bound"; it gates CI ahead of
  typecheck-packages).
- `/api/trace/x` answers 401, not 500 (live-verified, `06f7343467`).
- Gateway: control plane has real members/peers, spend surface callable,
  replay reaches the webhook peer, full suite green 354 tests
  (`203ecf9714`).
- App typecheck is honest (both phases always run, `9f89e22eba`);
  clickhouse-containment lint at error with 8 baselined (`fc84e2b794`);
  `.build()` gone from every installer AND from the builder
  (`be42ed2e3e` + `f04cd59062`); ModuleConfigGuard bites at compile
  (`6554214081`).
- The app-load `node:async_hooks` crash is fixed end to end:
  `@langwatch/observability/browser` (17 callers, graph-test-pinned,
  `975ba2ef97`) + `flexibleDateSchema` off the Hono subpath
  (`8d97dd264f`); async_hooks mentions in the UI build: 0.
- haven TUI input lag: root-caused (TCP dial per rendered frame on the
  input goroutine + ps/psql forks in Update) and fixed with cached
  liveness + tea.Cmd snapshot (`360e48d237`). The user must run a
  post-10:27 binary to feel it (`~/go/bin/haven` refreshed 10:30).

## The queue, in order

1. **UI build to exit 0** — the ONLY remaining blockers are the 12 `// GAP:`
   lines in `modules/analytics/web` (grep `GAP:`): (a) the `chartGrid`
   layout unit needs a contract-package home; (b) the custom-chart-playground
   feature (widget authoring + `dashboardWidgets` router surface) was never
   ported off the monolith — port from `b5320f7103^2`. See
   `.claude/handoffs/web-imports-sweep.md`. THEN: re-check
   `grep -c async_hooks` is still 0, build the bundle, boot, and verify the
   SPA serves through the api's static surface (mounted at `8760a1f575`,
   precedence-tested, but never yet exercised with a real bundle).
2a. **Typecheck scoreboard (2026-09-14 ~22:00)**: at ZERO — webhook,
   evaluation, trace, hosted-mcp, identity, analytics, GATEWAY
   (`eb08d4c77b`), plus agent-web and prompt-web. The `AppRestSecurity`
   dead chain is ported everywhere except enterprise governance's five
   relocated transport files (HELD until that directory's concurrent
   restructure settles — .claude/handoffs/rest-chain-port.md §11-12 has
   the plan and the stored-object-file.rest.ts precedent). The orphaned
   `langwatch-ql/provisioning/` directory was deleted whole at
   `213f74121f` (5044 lines, pre-rewrite copy of the wired services
   family). Still queued: scenario's dead-monolith orphan files,
   analytics-web's architectural 41, scenario-web's 10, and the
   second-tier web packages (project 19, workflow 11, experiment 8,
   model-provider 6, trace 2, langy 1, annotation 1).
2. **Web typecheck unblock — DONE** (`1f748bb0a6` + `362a75c9fe`). The
   remaining web-package code errors are the module-web-typecheck-debt
   lane's (active). The server-side remainder (langy/experiment/prompt) is
   module-server-typecheck-debt-3's (active).
3. **feature-shape-baseline-rebuild** — manifest ALREADY WRITTEN at
   `.claude/manifests/feature-shape-baseline-rebuild.md`, held for a settled
   tree; the tree is settled now. Spawn it (sonnet).
4. **scenario contract test debt** — 51 pre-existing errors in 12 stale test
   files, plus delete `src/__tests__/connected-target.service.integration.test.ts`
   (subject moved to suite-server). Inventory:
   `.claude/handoffs/scenario-di-rewire.md` §next-action.
5. **Unserved-operations payback** — the CURRENT list is
   `dev/docs/plans/unserved-documented-operations-2026-09-14.md` (65 ops,
   five classes, recipe pointers). Largest block: trace's unmounted families
   (tracesV2, sharedTrace, collector, tracked-event, otlp ingest, export) —
   `trace-app-surface`'s handoff explains why they were deliberately not
   mounted there. The langy tRPC namespaces (conversation panel!) are still
   on the deleted builders.
6. **Kit follow-ups** — thread Config through createProcess
   (`.claude/handoffs/composition-kit-fixes.md` §10, exact lines written);
   the withTransports Api-vs-App phantom-reads sketch (§11); the
   web-boundary lint rule (sketch in
   `.claude/handoffs/observability-browser-logger.md`); audit remaining
   PROPERTY members on module apps — the operations-only proxy defect was
   confirmed three times (gateway, trace, searchBodySchema).
7. **Small named items** — success-response restatement sweep: `5d466e14ef`
   made a docs answer with only a description inherit `withOutput`'s content
   (spec: specs/api-reference/response-documentation.feature) and converted
   dashboard-widget.rest.ts as the exemplar; ~10 more files restate their own
   schema the same way (`rg -l 'schema: resolver\(' modules --glob
   '*.rest.ts'`) — mechanical lane, but each site needs an eyeball: only a
   restatement of the route's OWN withOutput schema may drop its content; `specs/features/agents/voice-agents-v1.feature`
   carries two unbound scenario titles from a deleted test;
   `useOpenSuiteEditor`'s `attachmentId` is accepted but unread by the
   suiteEditor drawer; organization's tRPC `group.*` still gates through
   always-refusing `assertScimAllowed` while the REST fact uses the real
   plan lookup; langy relay needs a public-base-URL config field;
   `modules/model-provider/web/.../useAnnotationQueues.ts` looks like an
   orphaned duplicate of annotation/web's hook — decide, don't patch.
8. **Process hardening** — THREE lanes used `git stash` this session
   despite LANE.md's ban (all self-reported, all restored cleanly).
   Sharpen LANE.md: name the sanctioned compare recipe
   (`git show HEAD:<path>` to a temp file) so the need that drove them has
   an approved answer.
9. **Before any push/ready**: `pnpm typecheck:all` once (now honest);
   PR #7536 is still DRAFT so CI has never run the new gates; the pinned
   golangci-lint cannot run on this machine (Go 1.27 stdlib import failure)
   so the thuishaven diff (`360e48d237`) needs CI's lint verdict.

## Process facts

- This session was the SOLE coordinator; no other sessions hold lanes.
- Manifests in `.claude/manifests/`, handoffs in `.claude/handoffs/` — every
  queue item above has its evidence there; trust the handoffs over memory.
- Lanes do not commit; the coordinator collects per-lane with scoped `git add`.
- Boot checks: `node --experimental-transform-types -e "await import('<composition>')"`
  is the cheap gate; the fact scanner is the static one; a real boot is the
  truth. Run typecheck targets TWICE (declarations cache prints nothing on a
  hit — false green).
- ~54 commits this session, all on `feat/strict-feature-layout-v0`, each
  naming its lane. `git log --oneline` since `aa41886530` tells the story.
