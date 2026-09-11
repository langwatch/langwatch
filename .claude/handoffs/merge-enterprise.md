# Handoff: merge-enterprise

Status: partial
Manifest: .claude/manifests/merge-enterprise.md
Model: sonnet / effort unknown (as-launched)
Updated: 2026-09-11 17:05

## 1. Identity

Second attempt (fresh lane), continuing from the coordinator's reconstruction of
a first attempt that was stopped mid-run. This handoff is my own account.

## 2. Objective

Resolve the 224 conflicted paths under `enterprise/` in the live merge of
`origin/main`.

## 3. Owned paths

    enterprise/**

## 4. Shared paths - do not edit

`platform/**`, `packages/architecture-lint/src/*-baseline.json`, everything
outside `enterprise/`. Untouched.

## 5. The load-bearing finding

**All 224 of my paths are the governance-dashboard-port, not 178 mechanical
placements + 45 ordinary conflicts as the manifest assumed.** Verified by
mapping every one of the 178 `UA` paths through
`dev/docs/plans/main-merge-2026-09-11/file-location.txt` back to its origin:
100% trace to `platform/app/ee/governance/**` or
`platform/app/src/{components,pages}/*governance*` - main's cost/agent/people
dashboard - not to an unrelated moved directory. Same for all 45 `UU` and the 1
`UD`: every conflicted path in my area sits under `enterprise/modules/governance/**`
or `enterprise/packages/composition/api/src/governance/**`. There is no
non-governance content in `merge-enterprise` at all.

So the manifest's "leave governance alone beyond mechanical marker resolution"
carve-out is actually almost the whole area. What follows is what I found is
**not** a dashboard-vs-ingestion product conflict (those I left alone, per rule):
plain old-code-vs-new-code merge conflicts inside the parts of `governance` this
branch already owns (pullers, ingestion-sources, ai-tools, source-events).

**A second finding, more important:** several of these "ordinary" `UU`
conflicts silently pull in content from main that depends on shared UI
components deleted along with `platform/app` and never re-created here -
`FieldInfoTooltip`, `SmallLabel`, `DashboardSelect`, `ScopeChipPicker`. Because
git's 3-way merge only marks lines *both* sides touched, main's use of these
components lands as a **clean, unmarked merge** anywhere our branch's own
rewrite of that region happened to leave the base text alone - e.g.
`ingestion-source-catalog.ts` had `icon: <Anthropic />` JSX **silently merged
into a `.ts` file with no JSX support and no import**, which would not have
type-checked. Do not trust "no `<<<<<<<`" as "safe" in this subtree - diff
`:2:` against the working file before believing a clean region, not just the
marked ones (lane-rules #3, but it applies to whole regions here, not just
whole files).

## 6. Work completed this session

Governance-dashboard `UA` (178): confirmed all governance-port, none placed,
none invented a destination. This matches the manifest's own carve-out; record
only, per rule.

`UU`/`UD` resolved this session (9 files, all verified marker-free):

- `enterprise/packages/composition/api/src/governance/governance-kpis.clickhouse.repository.ts`
  - real bug: ours summed `SpendUsd` directly; main's query added a
    `GROUP BY ... argMax(SpendUsd, LastEventOccurredAt)` dedup subquery, which
    is what the file's own doc comment already promised. Took main's query,
    adapted to use the already-computed `sourceFilter` local var.
- `enterprise/modules/governance/web/src/features/source-events/ui/sections/source-events-table.tsx`
  + its integration test - merged: kept ours' `presentation` prop abstraction,
    added main's new `headerAside` prop and `isEmpty` gating on top of it.
- `enterprise/modules/governance/web/src/features/ingestion-sources/ui/elements/pull-cadence-field.tsx`
  + its integration test - reset to ours. Main's version depends on
    `FieldInfoTooltip`/`DashboardSelect`/`~/features/automations/...`, none of
    which exist here; verified via full `:2:` vs `:3:` diff that nothing else
    of substance was in main's version.
- `enterprise/modules/governance/web/src/features/ingestion-sources/ui/elements/trace-destination-field.tsx`
  + its integration test - reset to ours, same reason, plus main's picker uses
    `ScopeChipPicker` (the CLAUDE.md house pattern for scope selection) - which
    is objectively the *better* pattern but does not exist anywhere in this
    checkout (`grep -r ScopeChipPicker apps/ui packages` = nothing). Worth a
    real task: port `ScopeChipPicker` forward, then redo this field properly.
- `enterprise/modules/governance/web/src/features/ingestion-sources/model/ingestion-source-catalog.ts`
  - reset to ours. Main added a per-source-type `icon: React.ReactNode` field
    with JSX literals and a `SourceTypeIconGlyph` component **in a `.ts` file**
    - this branch deliberately keeps model files JSX-free (model/behavior/ui
    layering). The icon system also needs an `IconGlyph` component and vendor
    icon set not present here. Also carried `shouldOmitFromSample` (a plain
    boolean, safe) but I dropped it with the rest rather than hand-splice under
    time pressure - it is small and worth re-adding on its own.
- `enterprise/modules/governance/web/src/ui/sections/governance/governance-anomaly-rules.screen.tsx`
  - reset to ours (verified via diff: 1032 differing lines of 1021 total, i.e.
    almost entirely different files). Ours is a thin redirect shim to the
    inventory screen's tab; main's is the old standalone flat page. Ours' own
    comment says the shim is deliberate pending a route redirect.
- `enterprise/modules/governance/web/src/features/ai-tools/ui/sections/ai-tool-entry-drawer.tsx`
  - blended, not reset: took main's customer-facing "tool" wording (an
    already-landed, unconflicted comment in the file argues "tile" is the
    internal type name, "tool" is what the reader sees), kept ours' route
    (`/governance/departments`, our product's concept - main's said
    `/governance/people`, which is the dashboard-divergence page and does not
    exist here).
- `enterprise/modules/governance/web/src/features/overview/ui/blocks/spend-over-time-chart.tsx`
  (`UD`) - restored ours. Main deleted this file, but it is still imported
  live by `governance-overview.screen.tsx` on this branch; main's deletion was
  a side effect of removing its own (different) overview dashboard, not a
  statement that this component is unneeded.

Previous lane's 16 (governance/server, ingestion pulling): spot-checked per
lane-rules #3 - 15 blends/took-theirs, 1 "took ours"
(`ingestion-pull-worker.deadline.unit.test.ts`) which I verified is safe: both
sides wrote the identical test, main's via old `vi.doMock("~/server/db"...)`
plumbing that no longer exists, ours via the new contract-package imports.
Same behaviour, no drop.

## 7. Unfinished - 19 files still carrying markers

**Puller services (real backend logic, zero old-monolith dependency, needs
line-by-line judgment, not resettable):**

    enterprise/modules/governance/server/src/services/anthropic-admin-puller.service.ts       (9 conflicts, 1515 lines)
    enterprise/modules/governance/server/src/services/databricks-genie-puller.service.ts       (19 conflicts, 5128 lines)
    enterprise/modules/governance/server/src/services/openai-admin-puller.service.ts           (6 conflicts, 1214 lines)
    enterprise/modules/governance/server/src/services/http-poller.service.ts                   (5 conflicts, 533 lines)
    enterprise/modules/governance/server/src/services/s3-puller.service.ts                     (4 conflicts, 527 lines)
    enterprise/modules/governance/server/src/repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts (3 conflicts)
    + their 7 matching test files under services/__tests__/ (anthropic-admin-puller.behavior,
      databricks-genie-warehouse-cost, openai-admin-puller, http-poller-adapter.behavior,
      ingestion-pull-worker.dispatch, ingestion-pull-worker.ocsf-mapping, pulled-usage-record)

I sampled one earlier conflict in this family (`governance-kpis` dedup) and it
was a genuine correctness fix worth finding, not a reset candidate - I expect
the same is true here, at much larger scale. **Do not blanket-reset these.**

**Screens depending on missing shared components (same `FieldInfoTooltip` /
icon-system gap as above, but too large to safely verify by inspection alone
in the remaining budget):**

    enterprise/modules/governance/web/src/ui/sections/governance/governance-ingestion-source.screen.tsx  (8 conflicts, 1153 lines)
    enterprise/modules/governance/web/src/ui/sections/governance/governance-inventory.screen.tsx          (26 conflicts, 5593 lines)
    + their tests: __tests__/parser-config-fields.integration.test.tsx,
      __tests__/source-edit-destination.integration.test.tsx,
      __tests__/anthropic-form-controls.unit.test.ts

**One repository file not yet checked for a hidden correctness fix like
`governance-kpis`:**

    enterprise/packages/composition/api/src/governance/governance-ocsf-events.clickhouse.repository.ts (3 conflicts, 492 lines)

## 8. Shared-file requests

None.

## 9. Risks

- The missing `FieldInfoTooltip` / `SmallLabel` / `DashboardSelect` /
  `ScopeChipPicker` components are a real gap, not just merge noise - main's
  governance UI (and per `dev/docs/best_practices/scope-selector-and-badges.md`,
  probably other UI work too) assumes they exist. Worth its own small task:
  find or recreate them under the current design-system package, independent
  of this merge.
- The 19 remaining files are exactly the ones needing the most care (real
  billing/cost puller logic, and the two largest governance screens). I did
  not touch them rather than rush a wrong resolution on cost-calculation code.
- `rtk pnpm typecheck:one enterprise/modules/licensing/server` (the manifest's
  own smoke test) fails with 5 pre-existing errors, all `verbatimModuleSyntax`
  type-only-import violations and one missing `tryReadLicense` method on
  `LicenseStorage` - all in `enterprise/modules/licensing/server`, which I
  never touched. Not caused by this session; flagging because the manifest
  names this check as the gate.
- Licensing/entitlement behaviour: not touched, not adjusted.

## 10. Completion status

Of 224: 178 `UA` correctly left unplaced with reason (governance-dashboard
port). Of 45 `UU` + 1 `UD`: 25 resolved (16 prior + 9 this session, all
verified marker-free), 20 remain (19 `UU` with markers - see §7 - plus none
outstanding UD). No conflict marker survives outside the 19 named files.

## 11. Exact next action

Open `enterprise/modules/governance/server/src/services/s3-puller.service.ts`
(smallest remaining puller, 4 conflicts, 527 lines) and resolve its conflicts
by reading both `git show :2:` and `:3:` in full - these are real backend
logic differences, not resettable to either side. Do the same for the other
four puller services and their tests, then the two governance screens and
their three tests, then `governance-ocsf-events.clickhouse.repository.ts`.
Given the size of `databricks-genie-puller.service.ts` (5128 lines, 19
conflicts) and `governance-inventory.screen.tsx` (5593 lines, 26 conflicts),
budget for those two alone what this manifest budgeted for the whole area.
