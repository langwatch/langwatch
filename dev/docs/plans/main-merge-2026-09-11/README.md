# Merging origin/main, 2026-09-11

Measured at `a08cbd27b8`, merge base `105613d379` (5 days old).

```
ahead of origin/main:   2429 commits
behind origin/main:       85 commits
conflicted paths:       1282
```

## It is a merge, not a rebase

**2,429 commits ahead.** A rebase replays every one of them onto main, which is
the documented trap here: this repository squash-merges, so a long-lived branch
rebased onto a squashed base re-conflicts commit by commit, drops earlier merge
resolutions, and restales migration numbers. A merge brings the 85 commits in
once, with one set of resolutions, in one commit.

Never rebase this branch onto main. Merge main into it.

## The conflict shape

Produced by `git merge-tree --write-tree --name-only HEAD origin/main`, which
does the whole merge in memory and touches neither the index nor the working
tree. Re-run it to refresh; it is safe with agents working in the checkout.

| Category | Count | What it means | File |
| --- | --- | --- | --- |
| content | 456 | Both sides changed the same lines. Real judgment. | `content.txt` |
| file location | 453 | main **added** a file inside a directory this branch renamed. Git names the destination it suggests. Mechanical. | `file-location.txt` |
| modify/delete | 374 | main **deleted** a file this branch modified. Decide whether main's deletion should win. | `modify-delete.txt` |
| rename/delete | 48 | This branch renamed a file main deleted. | `rename-delete.txt` |
| directory rename split | 14 | This branch split one directory into several, so git cannot place main's additions. One decision per directory. | `directory-rename-split.txt` |
| rename/rename | 2 | Both sides renamed, differently. | `rename-rename.txt` |

Content conflicts cluster by area, which is what makes this parallelisable:

```
75 modules/scenario     57 docs/ai-gateway    56 sdks/typescript
43 enterprise/modules   24 modules/analytics  20 docs/integration
15 docs/ai-governance   14 docs/evaluations   12 skills/_tests
```

**Eight conflicts touch migrations** (6 file-location, 2 modify/delete). Those
are the coordinator's alone - migration ordering is global state and a lane
resolving one in isolation cannot see the ordering it breaks.

## The failure mode to design against

A previous main merge on this branch **half-reverted six PRs**. That is the
shape of the danger, and it is not exotic: taking `ours` is the cheap resolution
for all 1,282, it always applies cleanly, and it silently discards 85 commits of
other people's work.

So the rule for every lane, in every category:

> main's change either lands somewhere, or it is dropped with a stated reason.
> "Took ours" is not a resolution, it is a decision, and it gets a line in the
> handoff saying what main was doing and why it no longer applies.

`modify/delete` and `file-location` are where this bites hardest: both look like
"main touched a file we moved or deleted", and both are one keystroke from
losing the change.

## Why this suits the lane protocol

The conflicts partition cleanly by area, and - the part that makes it safe - a
lane resolving conflict markers is doing **ordinary file editing**. It cannot
corrupt the merge, because a lane makes no git write. That rule was written for
a different reason and happens to be exactly the property this work needs.

The architecture:

```
Coordinator                                Lane
  brings the tree to zero dirty
  starts the merge, leaves it conflicted
  writes one manifest per area      ---->    resolves markers in ITS files only
  (never two lanes in one area)              never runs git add / merge --continue
  reviews, stages, commits           <----   writes a handoff, stops
  owns migrations and shared files
```

## In this checkout, with no worktree - what that costs

The merge runs in the working checkout. That is a deliberate choice (a fresh
worktree of this repository needs its own install and generated files, which is
its own class of failure), and it has three hard preconditions:

1. **The tree must be at zero dirty first.** 188 files were dirty when this was
   measured. A conflicted merge on top of uncommitted work is not resolvable by
   inspection: a conflict marker and somebody's half-finished edit look the same,
   and `git merge` refuses outright where a local change would be overwritten.
   Land or discard every one of them before starting - and `git stash` is not the
   answer, since the stash stack is shared and a bare `stash push` takes every
   other agent's work with it.
2. **No other agent runs during the merge.** The tree is in a conflicted state
   for the whole of it. A lane that is not part of the merge will read conflict
   markers as source and try to fix them.
3. **The developer's stack is down for the duration**, because the tree does not
   boot mid-merge. `haven logs backend` is meaningless until the merge commits,
   so the "read the boot log after each step" rule is suspended and the boot is
   checked once, at the end, instead.

If any of those three is unacceptable on the day, that is the argument for a
worktree after all - not the other way round.

## Start with a pilot, not the whole thing

1,282 conflicts is many sessions. Do not write ten manifests up front.

**Pilot: `docs/`** - 173 conflicted paths, the most mechanical category mix, and
nothing that can break a boot. It proves the whole mechanism - a lane editing
markers without touching the index, the coordinator staging and committing, a
handoff another lane can continue from - at the lowest possible stake. If the
architecture is wrong, docs is where you want to find out, and a docs conflict
resolved wrongly costs a sentence rather than a boot.

Then, in order of rising risk: `sdks/typescript`, `modules/analytics`,
`modules/scenario`, `enterprise/modules`. Migrations and the 14 directory
rename splits stay with the coordinator throughout.

## Before starting

- Re-run `git merge-tree` and regenerate this ledger; it drifts as main moves.
- Decide the 14 directory rename splits first. They are the only category where
  a lane cannot make progress without a decision that is not in its manifest.

## Folding in the last of the migration

Measured, not assumed: the remaining migration work and the merge conflicts are
**almost entirely disjoint**.

```
modules/gateway    31 ports/adapters files    5 merge conflicts
modules/workflow   11 ports/adapters files    2 merge conflicts
modules/langy       1 ports/adapters file     6 merge conflicts

docs, sdks/typescript, modules/analytics, modules/scenario, enterprise/modules
                    0 ports/adapters files   - the whole heavy conflict load
```

And **no conflict lands in a `ports/` or `adapters/` file** - the 13 in those
three modules are in services, transport tests and web. So the hazard worth
checking for is not there: no lane will resolve main's change into a file the
migration is about to delete and lose it that way.

That means folding buys nothing in avoided double-touch, because there is no
double-touch. But it is still the right place for this work, for a simpler
reason: it is small, it is the last of it, and it wants a settled tree.

So it becomes the tail of the sequence rather than a parallel track:

| # | Area | Why here |
| --- | --- | --- |
| 1 | `docs/` | pilot - most mechanical, cannot break a boot |
| 2 | `sdks/typescript` | 56 content conflicts, self-contained |
| 3 | `modules/analytics` | 24 content conflicts |
| 4 | `modules/scenario` | 75 content conflicts, the heaviest |
| 5 | `enterprise/modules` | 43 content conflicts |
| 6 | `modules/gateway` | 5 conflicts **and** 31 ports/adapters files - one pass |
| 7 | `modules/workflow` | 2 conflicts **and** 11 ports/adapters files - one pass |
| 8 | `modules/langy` | 6 conflicts **and** 1 ports/adapters file - one pass |

Steps 6 to 8 are the only ones where a lane does both jobs, and they are last
because by then the tree is settled and the merge is behind them.

### What is actually left of the migration

The 2026-09-10 handover is stale on this and overstates it badly. Measured at
`a08cbd27b8`:

| Item | Handover said | Actually |
| --- | --- | --- |
| REST doors without a `mount:` | 11 | the doors file is **gone** - declarations drive it |
| `api-production.composition.ts` | 4,300 lines | **183 lines** |
| persistence under ports/adapters | 551 files | **43**, in gateway, workflow and langy only |
| legacy REST seam | 5 files | `api-rest.security.ts` and `app-rest/index.ts` gone; `app-trpc.sse.ts` and 5 `createAppRestSecurity` importers remain |

Separately, and **not** part of this sequence: the composition v2 seam work
(`dev/docs/plans/composition-v2-queue.md`, tasks T1 to T3). That is a different
body of work on `packages/runtime-composition`, it is gated behind its own
blocker, and it must not be interleaved with a merge.
