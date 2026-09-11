# Manifest: merge-scenario

Objective: All 196 conflicted paths under `modules/scenario` are resolved, and the two features main shipped here after the fork land on this branch rather than vanishing.
Owner: merge-scenario
Model: opus   <the heaviest area, and the only one carrying a known, verified case of main's work being silently dropped; it needs judgment about what a feature is, not just marker resolution>
Budget: 170 tool calls or 120 minutes, whichever comes first
Handoff: .claude/handoffs/merge-scenario.md

## Context

The tree is in a live, conflicted `git merge origin/main`, started deliberately by
the coordinator. 1,111 paths are unmerged; 196 are yours - the largest area.

**Read `dev/docs/plans/main-merge-2026-09-11/lane-rules.md` first.**

Your 196, by kind:

```
118  UA   main ADDED into a directory we moved   <- placement
 75  UU   both changed the same lines
  3  UD   main deleted, we modified
```

## Start here: two features of main's are already being dropped

This is verified, not suspected. `rerere` replayed a previous merge attempt's
answer into two of your files and **took ours**, which discards main's change
silently. Both symbols appear **zero times** on this branch:

| File | What the replayed answer discards |
| --- | --- |
| `modules/scenario/contract/src/scenario-run-parameter.error.ts` | `ScenarioFieldUnknownError`, a `HandledError` with code `scenario_field_unknown`, thrown when a scenario is saved with a field its suite does not declare |
| `modules/scenario/contract/src/scenario-run.ts` | `PENDING_EVALUATION`, a run status for a finished conversation whose attached evaluators are not yet recorded |

Main implemented these in `platform/app/src/server/scenarios/suite-fields.ts` and
`evaluator-attachments.ts` - files in the monolith this branch deleted, so the
implementations are **not** in your conflict list. `git show
origin/main:platform/app/src/server/scenarios/suite-fields.ts` reads them.

Your job for these two is the contract half: land `ScenarioFieldUnknownError` and
`PENDING_EVALUATION` in this branch's scenario contract, in this branch's shape.
A new error code also needs an entry in the client presentation registry
(`packages/handled-error/src/presentation.ts`) - that file is **not yours**, so
write the exact entry into handoff section 10.

If landing the server behaviour turns out to be more than the contract types, stop
and record what is missing. Do not port a feature out of the monolith on your own
initiative; that is a decision, and it is the coordinator's.

## Owned paths

    modules/scenario/**

## Shared paths - stop and request

    packages/handled-error/src/presentation.ts    coordinator - the error copy registry
    packages/architecture-lint/src/*-baseline.json coordinator
    platform/**                                   NOT YOURS - the deleted monolith, 303 separate conflicts
    everything outside `modules/scenario/`        other lanes or the coordinator

Three other lanes are live in `sdks/`, `modules/analytics` and `enterprise/`.

## Read-only reference paths

    dev/docs/plans/main-merge-2026-09-11/lane-rules.md
    dev/docs/plans/main-merge-2026-09-11/README.md        the rerere section names your two files
    modules/trace/server/**                               a module in the settled shape
    dev/docs/best_practices/error-handling.md             what a HandledError owes its caller

## Invariants

- A scenario run's status values and their meanings are a wire contract - the SDK,
  the UI and stored rows all read them. Adding `PENDING_EVALUATION` is additive;
  changing or removing an existing one is not, and is out of scope.
- A new error code carries a stable `code`, a customer-safe `message`, the correct
  `fault`, and an entry in the presentation registry. A code with no copy reaches a
  customer as "unknown error", which is a bug in the feature.
- No conflict marker survives.
- Main's change lands or is dropped with a stated reason.
- Do not invent a destination for a `UA` file with no sensible home; record it.
- No new dependency.

## Checks

    LC_ALL=C grep -rlF '<<<<<<<' modules/scenario/    -> must print nothing
    rtk pnpm typecheck:one modules/scenario/contract  -> at the end
    rtk pnpm typecheck:one modules/scenario/server    -> at the end

Errors outside `modules/scenario` are not yours; the tree is mid-merge.

## Stop conditions

- landing either feature needs code outside `modules/scenario/**`
- a `UU` resolution would change an existing run status or an existing error code
- the budget is reached - **expected at 196 paths; stop cleanly and say where you got to**

## Completion criteria

- no conflict marker under `modules/scenario/`
- `ScenarioFieldUnknownError` and `PENDING_EVALUATION` exist in this branch's
  scenario contract, or the handoff says exactly what stopped them
- the presentation-registry entry for `scenario_field_unknown` is written into
  handoff section 10, verbatim, ready for the coordinator to apply
- marker-less files checked per rule 3, with the took-ours count in the handoff
- both `typecheck:one` runs report nothing inside `modules/scenario`
