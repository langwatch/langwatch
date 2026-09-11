# Manifest: merge-sdks

Objective: All 61 conflicted paths under `sdks/` are resolved, with main's SDK changes landed or dropped with a reason.
Owner: merge-sdks
Model: sonnet   <61 pure content conflicts in one self-contained tree, no placement decisions and no deletions to adjudicate>
Budget: 120 tool calls or 90 minutes, whichever comes first
Handoff: .claude/handoffs/merge-sdks.md

## Context

The tree is in a live, conflicted `git merge origin/main`, started deliberately by
the coordinator. 1,111 paths are unmerged; 61 are yours.

**Read `dev/docs/plans/main-merge-2026-09-11/lane-rules.md` first.** It is the
rules every merge lane shares - no git writes, why `git status` keeps saying `UU`,
and why a file with no conflict markers may still be unresolved. It is short.

Yours is the cleanest area in the merge: **61 `UU` and nothing else.** No files
added by main into a directory we moved, no modify/delete, no deletions. Every one
is "both sides changed the same lines".

## Owned paths

    sdks/**

## Shared paths - stop and request

    everything outside `sdks/`                        other lanes or the coordinator
    sdks/**/package.json  - resolve, but flag         version/dependency lines are the coordinator's call
    any lockfile                                      regenerate, never merge

Three other lanes are live right now in `modules/analytics`, `modules/scenario`
and `enterprise/`. Do not read them as reference and do not touch them.

## Read-only reference paths

    dev/docs/plans/main-merge-2026-09-11/lane-rules.md      the shared rules
    dev/docs/plans/main-merge-2026-09-11/README.md          the merge plan
    dev/docs/plans/main-merge-2026-09-11/content.txt        the content-conflict list

## Invariants

- **The published wire is sacred.** These are shipped SDKs: an exported name, a
  method signature, a default, a serialised field. If a resolution changes one,
  that is a breaking change to a published package and it goes in the handoff with
  a reason, never silently.
- No conflict marker survives, including inside a code fence in a README.
- Do not "tidy" unconflicted code while you are in the file.
- No new dependency. Do not touch a lockfile.
- The TypeScript SDK's CLI boot path (`sdks/typescript/src/cli/**`) is the one
  place lazy `import()` is deliberate - if a conflict touches it, keep the lazy
  form on both sides.

## Checks

    LC_ALL=C grep -rlF '<<<<<<<' sdks/        -> must print nothing
    rtk pnpm typecheck:one sdks/typescript    -> once, at the end

Do not run a whole-tree check, `pnpm typecheck`, `pnpm lint` or the full test
suite. If `typecheck:one` reports errors in packages outside `sdks/`, they are not
yours - the tree is mid-merge and most of it is still conflicted.

## Stop conditions

- a resolution would change a published SDK's public surface
- a conflict is in a generated file or a lockfile
- the budget is reached

## Completion criteria

- no conflict marker under `sdks/`
- every marker-less conflicted file was checked against `:2:`/`:3:` per rule 3, and
  the handoff says how many took ours and what you did about them
- `rtk pnpm typecheck:one sdks/typescript` reports nothing inside `sdks/`
- the handoff lists any public-surface difference, with its reason
