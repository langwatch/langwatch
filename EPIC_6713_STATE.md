# Epic #6582 delivery state — LWQL saved-charts slices 3 + 5

Ralph loop directive: deliver entire epic, stacked PRs, review-clerk/fanout,
browser-QA with screenshots to langwatch/pr-screenshots before ready.

## DONE
- PR1 (S1 contract): #7426, branch issue6713/lwql-granularity-contract,
  commit e2d02af7c3. period_granularity_seconds reserved param, resolver,
  budget 10k, codes lwql_granularity_too_fine / _requires_window, save rules
  wired into LangWatchQLService.validate, A5 proven, parity OK, CI pending.
- O1 resolved by probe → sub-day steps only (day-scale needs period_timezone).
- A5 proven: validator accepts INTERVAL {p:UInt32} SECOND.

## NEXT (in order)
1. Await CI on #7426; fix any reds. Then review-clerk + fanout (/review
   procedure: principles+hygiene+security+test-reviewer, proof-reviewer if AC
   section). pr-ready-check BEFORE calling done. Keep DRAFT until reviewed.
2. PR2 (stacked ON issue6713/lwql-granularity-contract):
   branch issue6713/lwql-run-by-chart-id.
   - Run-by-chart-id entry: load chart via saved-workbench-charts repo,
     validate SQL through LangWatchQLService.validate with timeWindow +
     resolveLangWatchQLGranularity(onBudgetOverflow from surface), execute.
   - Workbench tRPC input: optional granularitySeconds on analytics.lwql.query
     when statement declares it; REST route likewise. Bind the two
     @unimplemented scenarios in specs/analytics/lwql-workbench.feature
     (lines ~897-928) by removing @unimplemented + adding real tests.
   - CodeRabbit on stacked PR: .coderabbit.yaml reviews.base_branches on the
     HEAD branch (sol.2026-07-07).
3. S2/S3 widget PRs (branch off PR2): graphType "governed_chart" +
   governedChartId; CustomGraph.tsx thin branch -> features/analytics-query
   renderer; range sync; granularity selector (LWQL_GRANULARITY_STEPS);
   clamp/truncated notices; lifecycle states; scheduled-reports skip;
   alerts refusal; kill switch at composition root. Browser-QA via operator
   agent (boot pnpm dev in worktree; OPENAI_API_KEY placeholder needed;
   browser-test@langwatch.ai / BrowserTest123!); screenshots ->
   langwatch/pr-screenshots raw URLs in body. O2 decision (schema column vs
   JSON embedded governedChartId) at S2 start.
4. Slice 5 (#6712): MCP tools mirroring charts REST CRUD; independent branch
   off main.

## RULES HIT THIS SESSION (do not re-learn)
- vitest paths are platform/app-relative even when run from root.
- pnpm typecheck AND typecheck:all (tests excluded from former).
- Fresh worktree: pnpm install + pnpm run start:prepare:files or 100s of
  missing-generated-client errors cascade.
- biome check --write then re-run; organize-imports is an error-level assist.
- Parity checker: @integration @unimplemented stubs must not ALSO exist in an
  older indented copy — dedupe before checking.
- noUncheckedIndexedAccess: no computed tuple index for a return value.
- evaluators.generated.ts regenerates dirty on fresh worktrees — never stage it.
- Commit by explicit pathspec always; push origin HEAD after confirming branch.

## STILL OWED (non-epic)
- Slack top-level correction of the lwql_experiment_runs error (threaded
  retraction exists at ts 1787327696.525149; user wanted main-channel posts).
- F20:lwql label proposal awaiting owner-gate answer.
- Records backlog: two poisoned corpus records, org-id flag bug issue,
  label-procedure record, LWQL structure record (gate asked 4x).

## ITERATION 2 UPDATE (2026-08-23 ~01:08 UTC)
- CI red on e2d02af7c3: lint noExcessiveCognitiveComplexity on
  resolveTimeWindow.ts + langwatch-app-complete rollup. FIXED in b4958262ea:
  resolver split into assertSurfaceStepIsClean + resolveAgainstBudget;
  two test fixtures corrected (week@60 overflows 10k ceiling → coarsens
  60→3600; exact-ceiling boundary built integer-exact).
- All scoped tests green post-refactor (46/46 incl. timeWindow).
- RATE LIMIT EXHAUSTED at ~00:58 UTC by 40s-interval REST polling.
  DO NOT call gh until ~02:00 UTC. Next iteration: single
  fetch_checks_rest classification on b4958262ea; if green → review-clerk +
  fanout on #7426, then PR2 (stacked branch issue6713/lwql-run-by-chart-id
  off this branch): run-by-chart-id entry + procedure input wiring,
  binding the two @unimplemented scenarios.
- NOTE: gh search issues --state all is INVALID (open|closed only).
- NOTE: --paginate --jq on check-runs errors "expected an object but got
  array" in some shapes — prefer fetch_checks_rest lib.

## ITERATION 3 (2026-08-23)
- CI on b4958262ea: GREEN. Zero pending/fail via fetch_checks_rest. PR head verified = b4958262ea.
- Review-clerk agent DISPATCHED on #7426 (background). Await its verdict notification;
  then adjudicate any threads, run pr-ready-check, decide ready/hold.
- PR2 stacked branch CREATED: ../issue6713-run-by-chart-id = issue6713/lwql-run-by-chart-id @ b4958262ea.
  Needs pnpm install + start:prepare:files before typecheck/test.
- NEXT ITERATION: implement PR2 in that worktree (run-by-chart-id service entry +
  granularitySeconds input on analytics.lwql.query tRPC + REST; bind the two
  @unimplemented scenarios by removing the tag + writing real tests).

## Iteration 6 — 2026-08-23
- Coder handback VALIDATED: typecheck=0 typecheck:tests=0 vitest 29/29, biome clean (6 files).
- COMMITTED bf3e8c08eb (6-file pathspec; excluded evaluators.generated.ts + this file), PUSHED to issue6713/lwql-granularity-contract. PR #7426 headRefOid == bf3e8c08eb confirmed.
- Threads PRRT_kwDOKRXhvM6bceaw/-x/-y replied naming fixing sha and resolved=true (readback verified).
- PENDING GATE: REST quota exhausted (403 at 10:05Z) — CI classify at bf3e8c08eb + shard tally + pr-ready-check + reviewDecision once quota restores.
- PR2 setup launched in .worktrees/issue6713-run-by-chart-id (pnpm install + start:prepare:files, log /tmp/pr2_install.log).
- PR2: advanced-coder dispatched into .worktrees/issue6713-run-by-chart-id (deps+codegen clean) to bind the two @unimplemented granularity scenarios via a saved-chart run entry point. Handback expected uncommitted w/ pathspec list.
- Shared GitHub REST quota is being drained fleet-wide within seconds of reset (rate_limit endpoint lies; real calls 403). Probe brbief2n1 waits on a REAL endpoint call succeeding. Deferred: gate battery (task 5), PR body no-ui-surface + verification sections (task 6), script-name issue (task 7).
- 2026-08-23 ~10:30Z: quota window used. PR body patched (no-ui-surface + verification sections, C6 cleared). CI at bf3e8c08eb FULLY green incl. breaking-change check; shard tally real (100 unit files, 69+120 integration). Remaining: clerk re-review (dispatched) -> READY -> gh pr ready 7426.

## S2/S3 design decisions (researcher report 2026-08-23, owner-settled)
- D1 LIVE REFERENCE: placed widget references saved chart id (dashboardId on workbench_sql row); no definition snapshot. Matches lwql-saved-charts.feature:21-22.
- D2 PARAMS: dashboard widgets always run SAVED parameter values; viewer overrides deferred.
- D3 GRANULARITY: per-widget picker in GraphCardMenu (steps [1,60,3600]) + auto-coarsen fallback citing MAX_BUCKETS + coarsenedFromSeconds side by side.
- D4 REST dashboards API: REDACT workbench_sql rows from GET /dashboards/{id} in v1 (consumer-contract safety); revisit deliberately.
- D5 SEQUENCE: S2/S3 land stacked ON PR2 (needs granularitySeconds in analytics.lwql.query input).
- Build notes: widget = consumer of workbench_sql ROW kind (not graphType); fight points graphs.ts getAll kind-filter :104-108, DraggableGraphCard blind cast :97, GraphCardMenu edit URL :51; vega behind lazy boundary ONLY (entry-chunk trap); period via usePeriodSelector URL params -> LangWatchQLTimeWindowValues -> lwql.query onBudgetOverflow:"coarsen"; flag-off degrades widget quietly (CustomQueryMenuLink availability pattern); alert bell hide/wire per kind; stats counters count only BUILDER_CHART_KIND (decide).
- 2026-08-23 ~11:15Z: CLERK READY at bf3e8c08eb (comment 5383609287, zero new threads). Self-approve structurally impossible (token==author) -> reviewDecision stays REVIEW_REQUIRED; needs owner/second login to clear. PR UNDRAFTED (gh pr ready OK); pr-ready-check overall=READY 0 failing. Fan-out dispatched: principles/security/test reviewers. Expect CodeRabbit wave on undraft (lw6634) — recheck before any merge claim.
- Fan-out security: CLEAN (no issues; error meta constrained to reserved-name constants + integers; copy customer-safe; granularity change narrows injection surface; run-time budget unwired until PR2 as disclosed).
- Fan-out principles: 3 MAJOR (supplied-name copy names wrong params on live path; granularity-type error message false on bad-step arm; coarsen can return finer-than-requested labeled coarsened) + 4 minor. Fix-coder dispatched into granularity worktree (TDD, uncommitted handback).
- Fan-out test: sound; 1 medium (regex-message assertion -> codeOf) + 3 lows + nits. All folded into fix-coder addendum (same commit). Fan-out complete: security CLEAN, principles 3M+4m, tests 1M+3l.
- PR state shift: reviewDecision now EMPTY (was REVIEW_REQUIRED), mergeable=MERGEABLE, BLOCKED likely = CodeRabbit legacy status from undraft wave (commented 10:48Z). Watch before merge claims.
