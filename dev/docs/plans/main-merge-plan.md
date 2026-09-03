# Merging origin/main into feat/strict-feature-layout-v0

**Written:** 2026-09-03. **Status:** proposed, waiting on Alex's go.

## Overview

The branch deleted `platform/app` and moved everything into `apps/{ui,api,worker}` + `packages/features/*`. main kept shipping into `platform/app` the whole time. Every PR that lands on main now costs a port, so the merge gets more expensive every day it waits, and main moves ~12 PRs a day.

**Goals:**

- one merge commit that brings main in, keeps `platform/` empty, and is mechanical enough to review
- every main PR that touched `platform/app` re-expressed in the package that owns that code now, one commit per PR so the port is traceable
- the branch pushed before any of this starts, it is 1,393 local commits with no remote copy

## Numbers (dry run with `git merge-tree`, 2026-09-03)

| | main | branch |
| --- | --- | --- |
| commits since base `5a9cd02001` (27 Aug) | 83 | 1,393 |
| files touched | 3,131 | 18,327 |
| `platform/app` files touched | 861 (311 added, 519 modified, 31 deleted) | all deleted |

Conflicted paths: **740**

| kind | count | what it is |
| --- | --- | --- |
| modify/delete | 284 | main edited a platform file the branch deleted |
| content | 255 | both sides edited, mostly files git carried over via directory-rename detection |
| file location | 205 | main ADDED a platform file inside a dir the branch renamed, git guesses the new home |
| directory rename split | 38 | git can't pick a destination, file lands under `platform/` |
| rename/delete | 33 | |

By area: 368 `packages/features` (246 scenario, 18 experiment, 16 suite, 13 navigation, 11 coding-agent, 9 trace/ops/analytics), 235 `platform/app`, 21 `sdks/typescript`, 13 `mcp/typescript`, 11 `skills/_tests`, 11 `packages/api`, 6 `apps/api`, 3 `apps/ui`.

The conflict markers are not the work. The work is the 6 big PRs:

| PR | platform files | other | lands in |
| --- | --- | --- | --- |
| #7590 agent-testing v2 polish round 6 | 287 | 1,647 | scenario/web, suite/web, docs |
| #7655 connected agents, decorated fn is a target | 282 | 317 | scenario, agent, sdks |
| #7638 legacy answer fields, one vocabulary for suites/run plans | 174 | 177 | scenario, suite, sdks |
| #7654 compare agents in one run | 109 | 84 | scenario/web |
| #7597 drop legacy chrome and the mode flag | 58 | 18 | navigation/web, apps/ui |
| #7696 finished connected-agent run reaches its verdict | 53 | 77 | scenario/server |

Plus ~20 small ones (ops flags rollout #7699, coding-agent cost splits #7757/#7680/#7697/#7690, nlpgo knobs #7647/#7614/#7705, LWQL door #7611, annotations inbox #7774, re-fold guard #7725, rollup read #7691, clickhouse #7720/#7630/#7816). Full list with counts: `git log 5a9cd02001..origin/main --first-parent`.

## Why a merge and not a rebase

1,393 commits, many of them merge resolutions from parallel lanes. A rebase replays each one and drops the resolutions (we've been bitten, see `rebase-drops-merge-resolutions`). One merge commit, resolved once.

## Shape

```
origin/main ───●───●───●─── ... ───●  (83 PRs, platform/app still alive)
                \                    \
                 \                    \  merge (mechanical: resolve, take-main, rm -r platform/)
                  \                    ▼
branch  ───●───●───●───●─── ... ───●───M───p1───p2───p3─── ... ───pN───► PR to main
           5a9cd02001                  │    └─ one port commit per main PR
                                       └─ tree does not typecheck between M and pN, that's fine, it's a branch
```

## Sequence

**0. freeze + backup** (before anything)

- wait for the live lanes (spec lane 6, spend-spike worker), commit them, start no new cleanup lanes until pN lands
- `git push -u origin feat/strict-feature-layout-v0`, open a draft PR. this is the backup, nothing else
- do the merge in a fresh worktree off the branch so the loop worktree stays usable

**1. the merge commit M** - mechanical only, no new code

- `git merge --no-commit origin/main`
- `platform/**`: every path is a delete. after resolving, `git rm -r platform/` and assert the dir is gone
- frozen artefacts take main's side: `docs/api-reference/openapiLangWatch.json`, `apps/api/src/features/discovery/openapi-document.json` (main added `/api/v1/query` and the org-key usage routes, we never regenerate)
- `docs/agent-simulations/*` deleted on main, modified here → take the delete. `docs/agent-testing/*`, `docs/**` content conflicts → take main, re-apply only path renames the branch made
- `sdks/typescript`, `mcp/typescript`, `skills/_tests`: branch changes there are import-path + lint rewrites, take main and re-run the branch's rewrite on the result, don't hand-merge 340-line diffs
- `FEATURE_MAP.md`, `dev/tests/agentic-e2e/**`, `dev/docs/adr/005-feature-flags.md`, `charts/langwatch/README.md`: hand merge, small
- "file location" files (main's new platform files) accept git's suggested home when it matches the strict layout, otherwise park under the owning feature package's `web/src` or `server/src` root for the port commits to place
- "directory rename split" files (38) land under `platform/` → move to the owning package by hand, same rule
- 2 new ClickHouse migrations from main (00087, 00088) go to `apps/api/src/tasks/clickhouse-migrate/migrations/`, numbers are free on the branch (we stop at 00086)
- commit M. gate: nothing under `platform/`, `pnpm install` clean, lockfile merged

**2. port commits p1..pN** - one per main PR, biggest first

lanes, one Opus agent each, files partitioned by feature dir, agents never stage or commit:

| lane | PRs | packages |
| --- | --- | --- |
| scenario-web | #7590 #7654 #7770 #7742 #7573 | scenario/web, suite/web |
| scenario-server + agent | #7655 #7638 #7696 #7714 #7715 #7639 | scenario/server, scenario/contract, agent, api-key |
| navigation + ops + ui shell | #7597 #7699 #7157 #7541 #7760 | navigation/web, ops, apps/ui |
| coding-agent + experiments | #7757 #7680 #7697 #7690 #7445 #7629 #7537 #7763 | coding-agent, experiment |
| server misc | #7611 #7647 #7614 #7705 #7725 #7691 #7720 #7630 #7816 #7774 #7626 #7651 #7704 #7703 | analytics, nlpgo wiring, eventing, metric, clickhouse tasks, annotation, governance, model-provider, feature-flag, authz |

each lane reads the main PR diff (`git show <sha> -- platform/`), finds where each platform file lives now (`git log --follow` on the branch, or the family manifests in `dev/docs/plans/ui-family-move-manifests.md`), applies the change there, rewires `~/` imports to package imports, keeps the strict layout grammar, runs only the suites its slice touches

gates per lane: `tsc --noEmit -p` for each touched package + `apps/api` + `apps/worker` + `apps/ui`, touched vitest suites, `oxlint`/`oxfmt` on touched files, parity for touched `.feature` files. no root `pnpm typecheck`

**3. sweep** after all lanes

- `TS2304` scan across touched packages, this is the half-revert detector (uses kept, declarations dropped, see `merge-5770224e31-half-reverted-six-prs`)
- stale `vi.mock` paths after moves
- arch-lint frontend-boundary guard, feature-parity, `check-feature-parity` LEGACY_INERT ratchet
- `dev/docs/plans/core-application-feature-extraction-plan.md` ledger entry
- push, CI on the draft PR is the whole-tree typecheck we never run locally

## Trade offs

**Merge now vs keep cleaning first:** every day of cleanup lanes adds nothing to the port cost, every day of main does. cleanup can resume after pN.

**Merge commit vs squash when landing on main:** 1,393 commits. a squash loses the per-PR port trail and the release pin (`release-pin-dies-in-squash`). recommend a merge commit.

**Take-main on sdks/mcp/skills:** cheaper than hand-merging, risk is a branch-side lint fix silently reverting, caught by `oxlint` on those dirs in step 3.

## Open questions for Alex

1. go now (freeze the 2 live lanes when they report) or let the loop finish its current backlog first
2. push the branch as a draft PR before the merge, yes/no (recommend yes)
3. land on main as merge commit or squash (recommend merge commit)
