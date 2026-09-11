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
  creates a dedicated worktree
  starts the merge, leaves it conflicted
  writes one manifest per area      ---->    resolves markers in ITS files only
  (never two lanes in one area)              never runs git add / merge --continue
  reviews, stages, commits           <----   writes a handoff, stops
  owns migrations and shared files
```

**In a dedicated worktree, never this checkout.** This checkout carries the
developer's running stack, other agents' in-flight work and 188 dirty files. A
conflicted merge here stops all of it.

All lanes share that one worktree, so owned paths must be genuinely disjoint -
which the category files make easy, since they are already lists.

## Start with a pilot, not the whole thing

1,282 conflicts is many sessions. Do not write ten manifests up front.

**Pilot: `docs/`** - 173 conflicted paths, the most mechanical category mix, and
nothing that can break a boot. It proves the whole mechanism - worktree, a lane
editing markers without touching the index, the coordinator staging and
committing, a handoff another lane can continue from - at the lowest possible
stake. If the architecture is wrong, docs is where you want to find out.

Then, in order of rising risk: `sdks/typescript`, `modules/analytics`,
`modules/scenario`, `enterprise/modules`. Migrations and the 14 directory
rename splits stay with the coordinator throughout.

## Before starting

- Re-run `git merge-tree` and regenerate this ledger; it drifts as main moves.
- Decide the 14 directory rename splits first. They are the only category where
  a lane cannot make progress without a decision that is not in its manifest.
