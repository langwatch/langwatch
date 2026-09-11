# Handoff: merge-analytics

Status: partial
Manifest: .claude/manifests/merge-analytics.md
Model: claude-sonnet-5 / effort unknown (as-launched) — launched as sonnet, no effort figure surfaced to me.
Updated: 2026-09-11 (lane 1, first attempt)

## 1. Identity

merge-analytics, lane 1, first attempt. No prior handoff existed.

## 2. Objective

Resolve all 99 conflicted paths under `modules/analytics` from the live
`git merge origin/main`, landing or recording-dropped every one of main's changes.

## 3. Owned paths

`modules/analytics/**`

## 4. Shared paths - do not edit

Everything outside `modules/analytics/`; `packages/architecture-lint/src/*-baseline.json`;
any generated file/lockfile.

## 5. Work completed

- All 24 `UU` (content) conflicts resolved, markers removed, verified by
  `LC_ALL=C grep -rlF '<<<<<<<' modules/analytics/` (0 hits in these files).
- Both `AU` conflicts (`lwqlProvisioning.unit.test.ts`, `lwql-views.integration.test.ts`)
  resolved the same way — these were add/add, not pure adds, and did carry markers.
- Ported a real security fix from main into production code: in
  `services/langwatch-ql-view-provisioning.service.ts`, row-policy statements
  now emit **before** grants in `setupStatements`, matching main's
  `catalogStatements.ts` fix. Old order left a window where a partially-run
  provisioning left a grant with no row policy — cross-tenant read exposure.
  This is a genuine tenancy-invariant fix, not a stylistic pick.
- Investigated and confirmed (not guessed) that main deleted the entire
  LangWatchQL "workbench" query-editor UI in PR #7870 ("sandboxed custom
  chart widgets over LWQL"), replacing it with ChartGrid + dashboard-widgets +
  a custom-chart-playground. Confirmed via `git log --diff-filter=D` against
  the merge base and reading that PR's commit messages — not a filename grep.
- Root cause found for two "M" behaviour files
  (`use-langwatch-ql-widget-run.ts`, `lwql-request-state.ts`): not part of the
  99, already clean, left untouched.

## 6. Files changed

24 `UU` + 2 `AU` files under `modules/analytics/{server,web}` — content merged,
in every case either "took ours" (main's code pointed at flat
`provisioning/`/`catalog/` paths this branch no longer has) or a deliberate
blend keeping main's improved prose/comments with paths fixed to point at our
`services/*.service.ts` files. Full list is `git diff` against `:1`/`:3` on
each; not reproduced here to stay under the line budget.

`modules/analytics/server/src/services/langwatch-ql-view-provisioning.service.ts`
— reordered `setupStatements` (row policies before grants); the only
production-code edit this lane made outside conflict resolution.

## 7. Checks completed

- `LC_ALL=C grep -rlF '<<<<<<<' modules/analytics/` → 2 files remain (see
  section 8) — everything else clean.
- `rtk pnpm typecheck:one modules/analytics/server` → **could not complete**:
  the declarations pre-step aborts on `packages/handled-error/src/{app-codes,presentation}.ts`,
  which still carry literal conflict markers. That package is outside my
  owned paths and mid-merge; per the manifest, errors outside
  `modules/analytics` are not mine. Re-run once `packages/handled-error` is
  resolved.

## 8. Current failure

Two files still carry conflict markers, both inside the subtree I'm
recommending be dropped (section 11): `modules/analytics/server/src/langwatch-ql/provisioning/__tests__/accessModel.unit.test.ts`
and `.../provisioning/__tests__/catalogStatements.integration.test.ts`. They
resolve to nothing once the coordinator executes the `git rm`s below — I did
not hand-resolve their internal markers because the files are not being kept.

## 9. Exact next action

The coordinator (or a follow-up lane) should `git rm` the following paths —
each is a documented drop, not an oversight (full reasoning in section 11):

**37 `UD`** — the old LangWatchQL workbench UI, everything under
`modules/analytics/web/src/{behavior,model,ui}` matching
`*langwatch-ql-{editor,chart-mode,result-*,schema-browser,time-window-editor,
diagnostics,granularity-picker,parameters-editor,value-cell}*`,
`vega-lite-spec-editor.tsx`, `saved-charts-toolbar*`, `custom-query-menu-link.tsx`,
`analytics-query.screen.tsx`, `use-saved-workbench-charts*`, `grid-positions.ts`,
`lwql-language-items*`, `lwql-schema-model*`, `lwql-value-format*` (see
`git status --porcelain modules/analytics | grep '^UD'` for the exact 37).

**6 `DU`** — `langwatch-ql/provisioning/{accessModel,catalogStatements,
postgresMapping,productionProvisioning}.ts` + 2 tests. Superseded by
`services/langwatch-ql-{access-model,view-statements,view-provisioning,
postgres-mapping,production-provisioning}.service.ts`; the one real fix
(row-policy/grant ordering) is already ported (section 5).

**30 `UA`** — two distinct new-capability clusters from main, neither with a
home in this branch's module shape, both escalated rather than guessed at:

  a. **Self-hosted LWQL provisioning** (11 files: `langwatch-ql/connection.ts`,
     `langwatch-ql/limits.ts`, `langwatch-ql/provisioning/{selfProvisioning,
     selfProvisionLock,postgresReaderProvisioning,index}.ts` + 4 tests + the
     2 markers-still-present tests in section 8). Real capability (issue
     #6635, `LWQL_SELF_PROVISION` env var derives a restricted ClickHouse
     identity with no hand-configured `LWQL_*` vars). Origin at
     `origin/main:platform/app/src/server/analytics/lwql/{connection.ts,
     limits.ts,provisioning/*}` for whoever ports it.

  b. **ChartGrid / dashboard-widgets / custom-chart-playground** (19 files:
     `repositories/{chartGrid,customGraphPlaygroundGate,dashboardWidgetDefinition}.ts`,
     `repositories/dashboard-widgets/*`, `web/src/ui/sections/{ChartGrid,
     DashboardAutoRefreshMenu,QueryParametersPanel,useDashboardAutoRefresh,
     useDraggableGraphCard}.ts(x)` + tests). This is main's replacement for
     the dropped workbench (PR #7870) — landing it is a real feature port
     (new UI, dnd model, in-place widget editing), not a merge resolution.
     Origin at `origin/main:platform/app/src/{server/analytics,
     components/analytics,features/custom-chart-playground}`.

Neither UA cluster was landed inert (dead unwired code was judged worse than a
documented drop — it would fail folder-shape/architecture lints and rot).
**This is the one call in this handoff that most deserves review**: I judged
both clusters as "too large to port safely in one lane's budget" rather than
a design choice to make myself, but the coordinator may disagree on scope and
choose to open a dedicated follow-up lane for (a) and/or (b) instead of
dropping.

After the `git rm`s: re-run
`LC_ALL=C grep -rlF '<<<<<<<' modules/analytics/` (expect empty) and
`rtk pnpm typecheck:one modules/analytics/server` (expect clean, once
`packages/handled-error` is also resolved).

## 10. Shared-file requests

None from me directly — all resolution is inside `modules/analytics/`. The
`git rm`s in section 9 need the coordinator's git-write access, not a shared
file edit.

## 11. Risks

- **The UD/UA split is the load-bearing finding of this whole lane.** Verified
  via `git log --diff-filter=D` on the merge base and by reading PR #7870's
  commit messages — not a filename grep, per lane-rules section 5. Confidence
  is high that main genuinely deleted the workbench UI as a deliberate
  product replacement, not a rename this branch's grep missed.
- Self-hosted provisioning (9a) and ChartGrid (9b) are both real, working
  features on `origin/main` that are simply absent from this branch after
  this lane's resolution. Both are recorded with their origin path so a
  follow-up lane does not have to re-discover them.
- I reverted one tempting improvement: main's `getMetric` in
  `analytics-registry.ts` made an unknown-group lookup return `undefined`
  instead of throwing (safer). I kept ours (throws) because the return-type
  widening touches two callers in `custom-graph.tsx`/`custom-graph.screen.tsx`
  in `modules/analytics/web`, which my check command
  (`typecheck:one modules/analytics/server`) does not cover, and I could not
  get a clean single-file `tsc` read on it. Low-value, low-risk either way —
  flagging rather than silently picking.
- Tenancy invariant re-checked specifically: `TENANT_COLUMN = "TenantId"` in
  `rules/lwql-view-catalog.rules.ts` survived its conflict; the
  `postgresTenantPredicate`/row-policy logic in the kept files still filters
  on it. No query lost its `TenantId` predicate in any resolution I made.
- rerere did not silently resolve any of my 24 UU/2 AU files — all still
  carried literal markers when I found them, so lane-rules section 3's
  "took ours" risk does not apply to this lane's content-conflict set.

## 12. Unfinished work

1. `git rm` the 73 paths named in section 9 (37 UD + 6 DU + 30 UA), or open
   follow-up lane(s) for clusters (a)/(b) instead of dropping them — this is
   the coordinator's call per section 9's flagged risk.
2. Re-run both checks in section 7 once (1) lands and `packages/handled-error`
   is resolved by whichever lane owns it.
3. If a follow-up lane ports cluster (a) or (b), it must also carry the
   `period_granularity_seconds`→`dashboard_context_granularity_seconds` /
   `period_start`/`period_end`→`dashboard_context_period_start`/`period_end`
   parameter rename that travels with them (seen in
   `lwqlGranularity.unit.test.ts` etc., all currently resolved to keep our
   `period_*` naming) — landing the UI without the rename, or the rename
   without the UI, breaks the reserved-parameter contract.

## 13. Completion status

All 99 conflicts have a recorded decision and no textual conflict was left
unresolved by guesswork; 26/99 (all real content merges) are fully landed in
the tree now. The remaining 73 are documented drops/escalations that need the
coordinator's `git rm` (or a scope decision to open follow-up lanes instead)
before `modules/analytics` is clean — this lane could not do that part
itself (no git writes).
