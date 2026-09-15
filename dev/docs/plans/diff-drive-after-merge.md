# The API and visual diff drive, to run once the merge lands

Written 2026-09-11 while the main merge is still conflicted. Nothing here can be
started before that merge commits - the first section says why.

## Why this waits for the merge, and why that is not just sequencing

`apidiff run` and `visualdiff run` both compare **two refs**, and both default to
`origin/main` against `HEAD`. Right now that comparison is meaningless: this
branch is 2,447 commits ahead and 86 behind, so a diff against `origin/main`
measures main's 86 commits of other people's work as loudly as it measures ours,
and every finding needs triage before it means anything.

The merge is what fixes that. Once `origin/main` is an ancestor of this branch,
`origin/main` vs `HEAD` is exactly the question worth asking: **what does this
branch change about the served surface and the rendered screens, on top of
everything main already has?** Every finding is then ours.

So this is not "do the merge first because it is queued". The merge is what makes
the drive interpretable.

## Preconditions, all four

1. **The merge is committed** and the tree is at zero dirty.
2. **`apps/api` boots.** Measured on 2026-09-11: `apps/api` had zero production
   files calling an undefined builder method, so the API side was already clean;
   all 13 offenders were `apps/worker` composition roots. Re-measure with
   `bash dev/scripts/shape-counters.sh` - `boot_shape_undefined` was 26 at the
   start of that session and 8 by the end. It reaching 0 is the signal.
3. **The worker boots too, for visualdiff.** apidiff probes the API and mostly does
   not care; visualdiff drives flows, and a flow that waits on a background job
   fails on the side whose worker is down. If the worker is still mid-conversion,
   run `visualdiff -routes-only` and leave flows for later.
4. **Nothing else heavy is running.** Each tool boots **two** full stacks. Running
   both at once is four stacks plus two `pnpm install`s, and the machine will not
   thank you. One tool at a time.

## Order

**apidiff first.** It guards the wire, which is the thing a refactor of this size
actually threatens, and it is the cheaper of the two. `visualdiff` second.

```bash
go run ./cmd/apidiff run -dry-run          # prints the plan, starts nothing
go run ./cmd/apidiff run -keep             # the real run
go run ./cmd/visualdiff run -keep -agent   # after apidiff is triaged
```

`-keep` leaves the worktrees and stacks up so a triage agent can re-probe a single
route without paying for a whole boot again. Remember to `haven destroy` them when
the drive is done; the run prints the names.

`-agent` gives plain, token-free output for an agent to read.

Exit status is the same ladder for both: `0` no findings, `1` findings, `2` the run
could not complete.

## What a run costs before it produces anything

Each tool: two `git worktree add`, then per worktree `copy .env`,
`pnpm install --frozen-lockfile`, `pnpm run start:prepare:files`,
`node dev/scripts/ensure-built.mjs`, then `haven up --agent --detach`. That is the
long pole and it is why `-dry-run` exists - it prints the exact command list
without starting anything, and it is worth reading once before committing to the
wait.

## Reading the findings, and the one pattern that works

Both tools append to `<run-dir>/findings.jsonl`, one JSON line per comparison,
flushed immediately. So the drive does **not** wait for the final report:

```
{"surface":"rest","name":"GET /api/prompts","kind":"identical","module":"prompt","detail":""}
```

`kind` is `absent-on-branch`, `status-differs`, `shape-differs`, `identical` or
`probe-failed`. The stream closes with one `{"kind":"run-complete","counts":{...}}`.

The pattern that worked before, and should be used again: **one persistent triage
agent reading the stream and fixing in batches**, rather than a fresh agent per
finding. It keeps the stacks warm, it re-captures only the affected routes, and it
avoids paying a fresh agent's start-up cost per finding. Sonnet is the right model
for it; the findings are concrete and the fixes are small.

Triage order, because not all `kind`s mean the same thing:

| kind | What it usually means |
| --- | --- |
| `absent-on-branch` | a route we dropped. **The most serious** - it is a removal we may not have intended |
| `probe-failed` | the branch could not answer at all. Often a boot or wiring bug, not an API change |
| `status-differs` | a status collapsed, very often to 200 or 500. A 404 that became a 200 is a regression, not a delta |
| `shape-differs` | a field added, removed or renamed. Additive is usually fine; removed is not |
| `identical` | noise, and most of the stream |

## Traps recorded from the last attempts

- **A run that produces an empty directory did not run.** `.apidiff/20260911-124750`
  has an empty `logs/` and nothing else: it never got a stack up. Check for
  `findings.jsonl` before believing a clean result.
- **`api_boot=no-stack` for a whole session** means every "read `haven logs
  backend`" step in every brief was a no-op. If the counters say `no-stack`, the
  boot evidence in any handoff from that session is worth nothing.
- **Do not diff against a stale base.** If main has moved again by the time this
  runs, `git fetch` first - but do not re-point the base at a ref the branch does
  not contain, or the interpretability argument at the top of this document stops
  holding.
- Both tools need `.env` and a working `haven`. `haven --version` printing `dev` is
  normal.

## What this drive is for

The branch deleted a monolith and rebuilt it as modules. A test suite proves the
modules work. It does not prove that the same routes answer on the same paths with
the same statuses, or that the same screens render - and the failure mode of a
refactor this size is not a red test, it is a screen that still renders and quietly
lost the endpoint behind it. That is the gap these two tools exist to close, and it
is the last thing standing between this branch and a pull request.
