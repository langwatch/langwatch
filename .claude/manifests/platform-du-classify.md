# Manifest: platform-du-classify

Objective: A verdict for every non-governance `DU` conflict in the deleted monolith — is main's edit already covered by this branch's rewrite, or is it a capability the new code lacks?
Owner: platform-du-classify
Model: sonnet   <one repeated, well-specified judgment over ~250 files; the reading is real but none of it is a design decision, and the few that are get escalated rather than decided>
Budget: 160 tool calls or 105 minutes, whichever comes first
Handoff: .claude/handoffs/platform-du-classify.md

## This lane writes no source code

You produce **one report**: `dev/docs/plans/main-merge-2026-09-11/platform-du-verdicts.tsv`.
That is the only file you create or modify. You resolve no conflicts, you place no
files, you edit nothing under `platform/`, `modules/`, `apps/` or `packages/`.

That is what makes you safe to run beside three lanes editing the same tree.

## Context

The tree is in a live, conflicted `git merge origin/main`. `DU` means "deleted by
us, modified by them": this branch deleted `platform/app`, main kept working in it.
312 such paths, 28,529 lines of main's changes.

Read `dev/docs/plans/main-merge-2026-09-11/platform-du-plan.md` first - it has the
full breakdown and the routing table. The inventory is
`platform-du-inventory.tsv` (`lines-changed <TAB> added-by-main <TAB> path`).

Two facts from it that you should not re-derive:

- **Not one of the 312 is a file main created after the fork.** All are edits to
  files that existed at the merge base. There is no hidden new module here.
- The churn is lumpy: 58 files are the governance port, 1 is a generated OpenAPI
  document, 1 is `package.json`.

## Your subset

Everything in `platform-du-inventory.tsv` **except**:

- anything matching `governance`, `ingestion-pull`, or `pullers` - 58 files, a
  decided feature port with its own lane
- `platform/app/src/app/api/openapiLangWatch.json` - generated, regenerated not merged
- `platform/app/package.json` - the coordinator's

That leaves roughly 250 files. Work them **largest first** by the inventory's line
count: the 27 files over 200 lines carry most of the risk, and a budget that runs
out should run out on the small ones.

## The judgment, and it is the same one every time

For each file:

1. `git diff <merge-base>..origin/main -- <path>` - what main changed and why.
2. Find the code that replaced that file on this branch. **Search for what it
   does** - the behaviour, the route, the error, the field - not what it is called.
3. Decide:

| Verdict | Means |
| --- | --- |
| `superseded` | this branch's rewrite already does what main's edit does |
| `gap` | main's edit is a capability the new code does not have |
| `unclear` | you could not find the replacement, or could not tell |

## Output format, exactly

Tab-separated, one line per file, no header:

    <verdict>	<lines>	<path>	<where it lives now, or ->	<one sentence>

The sentence is the whole value of this lane. For `superseded` it names the file
or symbol on this branch that covers it. For `gap` it says what is missing, in
terms of behaviour. "Looks fine" is not a sentence; neither is restating the path.

## Owned paths

    dev/docs/plans/main-merge-2026-09-11/platform-du-verdicts.tsv

Nothing else. Read anything; write only this.

## Read-only reference paths

    dev/docs/plans/main-merge-2026-09-11/platform-du-plan.md        the routing table
    dev/docs/plans/main-merge-2026-09-11/platform-du-inventory.tsv  your worklist
    dev/docs/plans/main-merge-2026-09-11/lane-rules.md              the shared rules
    modules/trace/server/**                                          a module in the settled shape

## The two ways this goes wrong

Both have already been paid for in this merge, once each:

- **Answering `superseded` from a filename or symbol grep.** The rewrite renamed
  almost everything: `optimization-studio/` became `workflows/`, ports became
  channels, `*.infrastructure.ts` became `*.members.ts`. A grep that finds nothing
  is not evidence. Search the behaviour.
- **Answering `superseded` because the file is deleted.** That is the `DU`
  category restating itself. Every one of these files is deleted; that is the
  premise, not the finding.

When you cannot tell, write `unclear`. An honest `unclear` costs the coordinator
one look; a wrong `superseded` loses a feature silently, which is exactly what
`rerere` was doing to two scenario features when this merge started.

## Invariants

- You write one file. No source edits, no git writes, no staging.
- Every line gets a verdict. A file you ran out of budget for is absent from the
  report, not marked `superseded` by default.
- Do not read `platform/app` as a guide to how this branch should look. It is the
  thing being deleted.

## Checks

    wc -l dev/docs/plans/main-merge-2026-09-11/platform-du-verdicts.tsv
    awk -F'\t' '{print $1}' <that file> | sort | uniq -c

Report those counts in the handoff. No test run, no typecheck - you changed no code.

## Stop conditions

- the budget is reached - **expected; stop cleanly and say how far down the
  size-ordered list you got**
- a file turns out to need a design decision to classify at all - mark it
  `unclear`, say why, and move on rather than stopping the whole lane

## Completion criteria

- `platform-du-verdicts.tsv` exists, one line per file examined, in the exact format
- every `gap` line names the missing behaviour, not just the path
- every `superseded` line names the file or symbol that covers it
- the handoff reports the verdict counts and the largest unexamined file
