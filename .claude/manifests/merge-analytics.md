# Manifest: merge-analytics

Objective: All 99 conflicted paths under `modules/analytics` are resolved, with main's analytics work landed or dropped with a reason.
Owner: merge-analytics
Model: sonnet   <99 paths across four conflict kinds, each with a rule already written; the judgment is per-file and bounded to one module>
Budget: 140 tool calls or 90 minutes, whichever comes first
Handoff: .claude/handoffs/merge-analytics.md

## Context

The tree is in a live, conflicted `git merge origin/main`, started deliberately by
the coordinator. 1,111 paths are unmerged; 99 are yours.

**Read `dev/docs/plans/main-merge-2026-09-11/lane-rules.md` first.** Short, and it
is where the traps are.

Your 99, by kind:

```
37  UD   main DELETED, we modified     <- read rule 6, it resolves against instinct
30  UA   main ADDED into a moved dir   <- placement
24  UU   both changed the same lines
 6  DU   we deleted, main modified     <- read rule 7, main's new features hide here
 2  AU
```

**`UD` is your largest category and the pilot got it wrong twice.** Do not decide
a page or module is gone because a filename grep found nothing - main renames
areas. Search for what the thing does.

## Owned paths

    modules/analytics/**

## Shared paths - stop and request

    everything outside `modules/analytics/`     other lanes or the coordinator
    packages/architecture-lint/src/*-baseline.json   coordinator
    any generated file or lockfile              regenerate, never merge

Three other lanes are live in `sdks/`, `modules/scenario` and `enterprise/`.

## Read-only reference paths

    dev/docs/plans/main-merge-2026-09-11/lane-rules.md
    dev/docs/plans/main-merge-2026-09-11/README.md
    dev/docs/plans/main-merge-2026-09-11/modify-delete.txt   filter to modules/analytics
    modules/trace/server/**    a module in this branch's settled shape, for where a file belongs

## Invariants

- Analytics owns LangWatchQL. A resolution must not change a query's meaning, an
  aggregation's default, or a tenancy predicate. **Every ClickHouse query keeps
  its `TenantId` filter** - if a conflict touches one, check the resolved query
  still has it.
- No conflict marker survives.
- Main's change lands or is dropped with a stated reason - per `UD` and `DU` file.
- Do not invent a destination for a `UA` file that has no sensible home; record it.
- No new dependency.

## Checks

    LC_ALL=C grep -rlF '<<<<<<<' modules/analytics/   -> must print nothing
    rtk pnpm typecheck:one modules/analytics/server   -> once, at the end

Errors outside `modules/analytics` are not yours; the tree is mid-merge.

## Stop conditions

- a `UD` file documents or implements a capability this branch still has and main
  has nothing equivalent - stop and ask, do not decide it alone
- a resolution would change a query's tenancy scoping
- the budget is reached

## Completion criteria

- no conflict marker under `modules/analytics/`
- each of the 37 `UD` recorded as "carried to <path>", "dropped because <reason>"
  or "escalated"
- each of the 6 `DU` recorded as "superseded by <what>" or "needs a home"
- marker-less files checked per rule 3, with the took-ours count in the handoff
- `typecheck:one modules/analytics/server` reports nothing inside your area
