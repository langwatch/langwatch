# Manifest: merge-enterprise

Objective: All 224 conflicted paths under `enterprise/` are resolved, with main's enterprise work placed in this branch's layout or dropped with a reason.
Owner: merge-enterprise
Model: sonnet   <178 of the 224 are placement of files main added into moved directories, which is mechanical once the destination is known; the 45 content conflicts are ordinary>
Budget: 160 tool calls or 105 minutes, whichever comes first
Handoff: .claude/handoffs/merge-enterprise.md

## Context

The tree is in a live, conflicted `git merge origin/main`, started deliberately by
the coordinator. 1,111 paths are unmerged; 224 are yours.

**Read `dev/docs/plans/main-merge-2026-09-11/lane-rules.md` first.**

Your 224, by kind:

```
178  UA   main ADDED a file into a directory this branch moved   <- the bulk, and it is placement
 45  UU   both changed the same lines
  1  UD
```

So your area is mostly one question repeated: **where does this file main added
belong in the new layout?** A module here is `enterprise/modules/<name>/` split
into `contract`, `server` and `web`. Read one settled module before placing
anything, and place by what the file does - a service beside services, a
repository beside repositories.

## The one thing to leave alone

`enterprise/modules/governance/**` content conflicts are **not yours** beyond
mechanical marker resolution. Main built a governance dashboard (costs, agents,
people, filters) that this branch does not have, and this branch built a
governance module around ingestion and departments that main does not have. That
divergence is a feature port with its own lane, decided already - see
`dev/docs/plans/main-merge-2026-09-11/directory-rename-split-decisions.md`.

If a governance conflict is a marker in a file both sides edited, resolve it. If it
is main's whole new dashboard arriving, **leave it and record it** - do not try to
place 140 files of a product area nobody has reconciled yet.

## Owned paths

    enterprise/**

## Shared paths - stop and request

    platform/**                                    NOT YOURS - the deleted monolith
    packages/architecture-lint/src/*-baseline.json  coordinator
    everything outside `enterprise/`                other lanes or the coordinator

Three other lanes are live in `sdks/`, `modules/analytics` and `modules/scenario`.

## Read-only reference paths

    dev/docs/plans/main-merge-2026-09-11/lane-rules.md
    dev/docs/plans/main-merge-2026-09-11/directory-rename-split-decisions.md
    dev/docs/plans/main-merge-2026-09-11/file-location.txt    git's own suggested destinations
    enterprise/modules/licensing/**                            a settled enterprise module
    modules/trace/server/**                                    the module shape generally

`file-location.txt` is worth reading before you place anything: for a `UA`
conflict git names the destination it would have chosen, and it is usually right.

## Invariants

- Enterprise code stays enterprise. Do not place a file main added under
  `enterprise/` into `modules/` or `apps/`, whatever it looks like it does.
- No conflict marker survives.
- Main's change lands or is dropped with a stated reason.
- A file with no sensible destination is recorded, never invented.
- No new dependency.
- Licensing and entitlement behaviour is not adjusted while resolving - if a
  conflict changes who is entitled to what, that goes in the handoff.

## Checks

    LC_ALL=C grep -rlF '<<<<<<<' enterprise/    -> must print nothing
    rtk pnpm typecheck:one enterprise/modules/licensing/server   -> at the end, as a smoke test

Do not typecheck every enterprise module; most of the tree is still conflicted.
Errors outside `enterprise/` are not yours.

## Stop conditions

- main's governance dashboard, as described above - record, do not place
- a `UA` file whose destination you cannot determine from `file-location.txt` or
  from what the file does
- the budget is reached - **expected at 224 paths; stop cleanly**

## Completion criteria

- no conflict marker under `enterprise/`
- every `UA` file either placed, or recorded with why it has no home
- marker-less files checked per rule 3, with the took-ours count in the handoff
- the handoff names every governance file it deliberately left for the port lane
- `typecheck:one enterprise/modules/licensing/server` reports nothing inside your area
