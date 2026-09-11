# Handover: the main merge, mid-flight

Written 2026-09-11 ~17:10, session ending. Alex is finishing this on the move.

## Resume from the live merge, not from a commit

The working tree still holds the merge: `MERGE_HEAD`, the staged resolutions and
the conflict stages are all intact and persist across sessions. **That is the
state to continue from.** Committing it would discard stages `:1:`/`:2:`/`:3:`,
and those are what make the remaining 754 tractable.

A two-parent backstop exists at `refs/wip/merge-partial-2026-09-11`
(`878b589a2a`, parents `026bb5be82` + `dd6aa6efd3`). No branch points at it. Its
tree contains 67 files with literal conflict markers - recovery only, never a
build.

The one command that destroys the work: `git merge --abort`. Also `git reset`.

## Counters

```
unmerged   1282 -> 754        markers 67        rerere cache 2,755 entries
done       docs, sdks, modules/scenario, modules/analytics (99 -> 0)
open       platform/app 305, enterprise/modules 145, enterprise/packages 78,
           dev/scripts 27, modules/authz 21, modules/trace 19, apps/ui 18
```

## The method that matters most

To ask "what did main actually change here", diff **`:1:` (base) against `:3:`
(theirs)**. Diffing ours against theirs conflates this branch's restructure with
main's change and makes every file look rewritten - that is how an earlier lane
reported 19 analytics files as safe "took ours" when only 2 were.

```bash
git show ":1:$f" > /tmp/b; git show ":3:$f" > /tmp/t; diff -u /tmp/b /tmp/t
```

A **took-ours** (worktree identical to `:2:`) is the shape worth auditing, because
rerere replays it silently and it is what drops main's work with no marker to see.
Repo-wide audit of the remaining conflicts found 8; 7 are real and listed below.

Counter-lesson, learned by getting it wrong: "main added a line we lack" is NOT
the same as "we lost the behaviour". `infra/docker/Dockerfile` looked like a drop
for two COPY lines; this branch does `COPY modules ./modules` wholesale and both
files live under `modules/scenario/contract/src/`. Already satisfied. Staged ours.

## Exact next actions

1. **enterprise/governance ingestion-sources - 5 took-ours with real main work**,
   the highest-value unresolved items because they will not announce themselves:

   ```
   model/ingestion-source-catalog.ts                  95+   9-   retired/deprecated/sample flags
   __tests__/pull-cadence-field.integration.test.tsx  82+  13-
   ui/elements/pull-cadence-field.tsx                 45+  36-
   __tests__/trace-destination-field.integration...   40+  34-
   ui/elements/trace-destination-field.tsx            27+  52-
   server/src/services/__tests__/ingestion-pull-worker.deadline.unit.test.ts  5+ 1-
   ```

   All under `enterprise/modules/governance/web/src/features/ingestion-sources/`.

2. **enterprise is one task, not two.** Its lane established that all 224 paths
   are governance-dashboard related, so `enterprise/` and the "governance port"
   are the same body of work. Manifest `.claude/manifests/merge-enterprise.md`
   needs that premise corrected before a lane is spawned against it.

   Watch for the failure mode that area specialises in: conflicts that merge
   **cleanly** while importing components deleted with the monolith
   (`FieldInfoTooltip`, `ScopeChipPicker`). One put JSX into a `.ts` model file.
   A marker grep says nothing about any of it.

3. **platform/app 305 DU** - classifier resumed at row 53,
   `platform/app/src/app/api/projects/[[...route]]/app.ts`. Inventory and
   verdicts in `dev/docs/plans/main-merge-2026-09-11/platform-du-*.tsv`,
   handoff `.claude/handoffs/platform-du-classify.md`. Measured: 28,529 lines,
   **zero files main created after the fork**, 38% is the governance port,
   4,430 lines is one generated file.

4. `packages/clickhouse-client/src/tasks/ttl.reconciler.ts` - a genuine logic
   merge, wants its own lane.

## Landed this session, so it is not redone

`modules/analytics` 99 -> 0, on Alex's ruling **"follow what's on main"**:
workbench dropped (37), ChartGrid + self-hosted-provisioning landed (28), 9
took-ours reversed to theirs, 2 duplicate tests dropped after confirming all 32
and 14 of main's test titles exist in ours.

Three real defects fixed while resolving, each of which read as green:
- the `period_*` -> `dashboard_context_*` reserved-parameter rename was
  **half-applied** - contract and migration had it, three test files still
  asserted the old literals, so they pinned names the code no longer emits;
- `analytics-registry.getMetric` threw a raw `TypeError` on an unknown group
  (main returns `undefined`); both call sites already handled undefined, so
  widening the type cost nothing;
- a `@scenario` title rename left a test **vacuously bound** - our feature files
  already carried main's titles. Binding audit now reports zero unbound in the
  module.
- `graph-card-menu` kept an Edit item pointing at the workbench route deleted in
  the same merge. A dead link the merge itself would have introduced.

`enterprise/.../governance-anomaly-rules.screen.tsx` 1021 -> 35, taking main's
shim. Verified first that our `AnomalyRulesTab.tsx` is 1,079 lines with no
declaration missing against main's - the consolidation target is fully present.

## Lane in flight

`merge-analytics-port` (opus), manifest `.claude/manifests/merge-analytics-port.md`,
handoff `.claude/handoffs/merge-analytics-port.md`. Repointing main's ChartGrid
and LWQL provisioning imports off the monolith layout. Analytics conflicts are
zero; this is the port they were staged ahead of, same class as `modules/scenario`'s
TS2307s.

**Its overriding constraint, from Alex: keep the LangWatchQL code SUPER similar
to main - Drew wrote it days ago and is still working in it.** Transpose, do not
improve. The existing transposition is already faithful (`assertNames(names)` ->
`this.assertNames(names)` and a class wrapper, bodies and doc comments verbatim),
and the port must match it.

If the lane's row is still `active` in `.claude/coordinator/LANES.md` with no
handoff on disk, its work died with the session - re-spawn from the manifest.

## What the analytics-port lane found (it reported, then stopped early)

It stopped on a wrap-up instruction at 56 of 160 tool calls, not at budget.
Handoff: `.claude/handoffs/merge-analytics-port.md`. Four things outrank the
rest:

1. **`packages/clickhouse-client/src/tasks/ttl.reconciler.ts` has 12 live
   conflict markers and it blocks EVERY typecheck in the repo**, because the
   shared declarations prebuild runs before any package is reached
   (`TS1185: Merge conflict marker encountered`). Nothing can be verified until
   this one file is resolved. It was already on the list as "a genuine logic
   merge, wants its own lane" - it is now the **first** thing to do, not a
   later one.

2. **Main's `LWQL_SELF_PROVISION` capability is dead code here.** The
   provisioning files landed, but base->main also added 298 lines to
   `platform/app/src/tasks/provisionLwql.ts` (`selfProvisionAll`,
   `redactSecrets`, explicit mode selection, advisory-lock wrapping). Our
   `modules/analytics/server/src/tasks/lwql-provision.task.ts` is 296 lines
   against main's 462 and mentions none of `selfProvision`, `manage-role` or
   `LWQL_MANAGE_POSTGRES_READER`. Nothing imports `selfProvisioning`,
   `selfProvisionLock` or `postgresReaderStatementsFor`. **Issue #6635 is a
   feature port needing its own lane, not an import repoint** - and it is the
   `unused-config-object-is-a-wiring-bug` shape: present, compiling, unreachable.

3. **`chartGrid.ts` has a placement question the port cannot route around.** It
   landed under `analytics/server/src/repositories/` but is imported by five
   files in `analytics/web` and by `modules/trace/server`. Only
   `@langwatch/analytics-contract` is reachable from all three. Needs a call
   before the ChartGrid half can finish.

4. Two imports left deliberately broken rather than guessed, both crossing into
   another lane's paths: `featureFlagService` in `dashboard-widgets/access.ts`
   (the obvious fix changes `customChartPlaygroundEnabled`'s signature, whose
   caller is in `modules/trace/server`), and `dashboardBelongsToProject`, which
   exists only in main's monolith while the behaviour lives in
   `modules/dashboard/server` - which analytics may not import.

Two shared-file requests it could not perform itself:
- `pnpm install` at the repo root - it added `@langwatch/prisma-client` and
  `nanoid` to `modules/analytics/server/package.json`; unlinked until then.
- delete `modules/analytics/server/src/langwatch-ql/provisioning/index.ts` (the
  dead barrel; `rm` was refused by the permission classifier).

Its edits are uncommitted in the worktree and ARE included in the
`refs/wip/merge-partial-2026-09-11` snapshot.

## Continuing on a DIFFERENT machine

Only commits travel. The conflict stages (`:1:`/`:2:`/`:3:`) and the 2,755-entry
`.git/rr-cache` are local to the machine that ran the merge and do **not** push.
So the `:1:` vs `:3:` method above does not work from a fresh clone as-is - you
have to regenerate the stages first.

The recipe that gets both the stages and this session's work:

```bash
git fetch origin wip/merge-partial-2026-09-11
git checkout feat/strict-feature-layout-v0

# 1. regenerate the conflict stages locally (rerere will NOT replay here,
#    which is a feature - nothing is answered silently on this machine)
git merge origin/main          # expect ~1282 conflicts, the full set

# 2. lift every path this session already resolved, out of the snapshot
git checkout FETCH_HEAD -- modules/analytics modules/scenario sdks docs \
    enterprise/modules/governance/web/src/ui/sections/governance/governance-anomaly-rules.screen.tsx \
    infra/docker/Dockerfile

# 3. and the plans + coordinator state
git checkout FETCH_HEAD -- dev/docs/plans .claude/handoffs .claude/manifests
```

Step 2 is safe precisely because those paths were taken to zero unmerged here;
everything still conflicted is untouched by it and keeps its stages.

`.claude/handoffs/` and `.claude/manifests/` are **gitignored**, so they are in
the snapshot only because it force-added them. Do not expect them from a normal
clone or a later ordinary commit.

What you lose on the other machine and cannot get back: the rerere cache. That is
mostly good news - 199 of its replays were silent, and 2 dropped real work. A
fresh merge asks you every question instead of answering some of them for you.
