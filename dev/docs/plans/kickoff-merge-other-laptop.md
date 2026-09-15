Picking up the `origin/main` merge into `feat/strict-feature-layout-v0`, on a
different machine from the one that started it.

Read `dev/docs/plans/handover-2026-09-11-merge-partial.md` first. It is the
state of the drive and it is current. Then `.claude/coordinator/COORDINATOR.md`
for the lane protocol, and `dev/docs/plans/main-merge-2026-09-11/lane-rules.md`
for the traps.

Set up the tree before anything else. The previous machine's merge state does
not travel — only commits do — so regenerate the conflict stages here and lift
the finished work out of the snapshot:

    git fetch origin wip/merge-partial-2026-09-11
    git checkout feat/strict-feature-layout-v0
    git merge origin/main
    git checkout FETCH_HEAD -- modules/analytics modules/scenario sdks docs \
        enterprise/modules/governance/web/src/ui/sections/governance/governance-anomaly-rules.screen.tsx \
        infra/docker/Dockerfile
    git checkout FETCH_HEAD -- dev/docs/plans .claude/handoffs .claude/manifests

Expect ~1282 conflicts from that merge, not 754. That is correct: the other
machine had a 2,755-entry rerere cache answering some of them silently, and it
does not transfer. You get asked every question instead. Two of its silent
answers had dropped real work, so this is the better position.

First action, before any lane: resolve
`packages/clickhouse-client/src/tasks/ttl.reconciler.ts`. Its 12 conflict
markers fail the shared declarations prebuild, so every typecheck in the repo
dies with TS1185 before reaching any package. Nothing is verifiable until it is
done. It is a genuine logic merge, not a pick-a-side.

Then the open areas, largest first: `platform/app` 305, `enterprise` 223 (one
task with the governance port, not two), `modules/authz` 21, `modules/trace` 19.

The method, which matters more than any individual file. To ask what main
actually changed, diff `:1:` (base) against `:3:` (theirs):

    git show ":1:$f" > /tmp/b; git show ":3:$f" > /tmp/t; diff -u /tmp/b /tmp/t

Diffing ours against theirs conflates this branch's restructure with main's
change and makes every file look rewritten. That mistake led one lane to report
19 analytics files as safe "took ours" when only 2 were; the rest were dropping
main's work, including the feature Alex had just said to adopt.

Rules that are not negotiable here:

- Never delete a file to clear a type error. If main shipped something with no
  home here, that is an escalation in the handoff, not a deletion.
- Never blanket-resolve a directory. A silent revert is the failure mode this
  whole merge exists to prevent, and it always looks finished.
- Keep the LangWatchQL code SUPER similar to main. Drew wrote it days ago and is
  still working in it. Transpose, do not improve.
- Do not run `pnpm typecheck` (whole-tree, takes a machine slot). Use
  `pnpm typecheck:one <package>`.

Two decisions are Alex's, not yours. Ask, do not guess:

1. `chartGrid.ts` placement — it sits in `analytics/server/src/repositories/`
   but is imported by five `analytics/web` files and by `modules/trace/server`.
   Only `@langwatch/analytics-contract` is reachable from all three. The
   ChartGrid port cannot finish without this.
2. Issue #6635, main's `LWQL_SELF_PROVISION` capability, is dead code on this
   branch — the provisioning files landed, the 298 lines of task that drive them
   did not. Whether to port it now or defer is a scope call.

Two chores carried over: `pnpm install` at the repo root (the analytics-port
lane added `@langwatch/prisma-client` and `nanoid` to
`modules/analytics/server/package.json`), and delete the dead barrel
`modules/analytics/server/src/langwatch-ql/provisioning/index.ts` — nothing
imports it and three of its re-export targets are now service methods.

Report counters honestly every time you report: unmerged, marker files, lanes
active. A named failure is worth more than a green you arranged.
