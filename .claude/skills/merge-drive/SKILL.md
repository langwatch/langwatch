---
name: merge-drive
description: "Carry a long-running conflicted merge of origin/main into a branch that restructured the tree: read the merge state from the index, resolve by class, and hand it to the next session without losing work. Covers the classes git reports as already-resolved (silent resurrections, directory-rename ports, half-landed features delivered by the clean merge), the stage-diff method that asks what main actually changed, how to tell reformatting from substance before merging anything by hand, and when to snapshot, lane or stop. Use when someone says 'continue the merge', 'what is the state of the merge', 'how do I resolve these conflicts', 'finish merging main', or opens a session on a checkout with MERGE_HEAD present."
user-invocable: true
argument-hint: "(nothing - reads the merge in progress), or a path prefix to work only that area"
---

# Carry a long merge

A merge big enough to outlive one session is not a bigger version of a small
one. It has its own failure mode: **it always looks finished.** Every technique
below exists because the finished-looking state was wrong.

## 1. Read the state before saying anything about it

```bash
bash dev/scripts/merge-state.sh --full
```

Recomputed from the index every time, so it cannot go stale. Never quote a
conflict count from a handoff when this command is available - the last session
resolved files after it wrote that number.

If it prints `no merge in progress`, there is nothing to carry. Stop.

## 2. Read what binds you

| File | What it gives you |
| --- | --- |
| `.claude/skills/core/repository-rules.md` | what binds every agent here |
| `.claude/skills/core/handoff-rules.md` | the seven statuses, the 150-line cap |
| `.claude/handoffs/merge-*.md` | what earlier merge lanes already settled |

Read the branch's own purpose before resolving anything. A restructuring branch
deletes things **on purpose**, and main kept developing them; without knowing
which tree moved where, every conflict looks like a coin flip.

## 3. Resolve by class, not by file order

`git status --porcelain` gives the class in the first two columns. Stage
availability is what the class actually means:

| Class | Stages | Means | The question to ask |
| --- | --- | --- | --- |
| `UU` | 1 2 3 | both changed it | what did main change, and does it still apply here? |
| `DU` | 1 3 | **we deleted, main changed** | where did this move to, and does main's change need porting there? |
| `UD` | 1 2 | we changed, main deleted | did main delete it deliberately, or did it move? |
| `UA` | 3 | main added, we have no side | does this belong in the new layout, and under what path? |
| `DD` | 1 | both deleted | resolve with `git rm`; verify both meant it |

`DU` is where work gets lost. "Keep the delete" is one keystroke and it silently
drops whatever main changed. Each `DU` is a real change of main's that lands
nowhere unless you port it to wherever that code now lives.

## 4. The two classes git reports as resolved

Neither carries a conflict marker. Neither appears in `--diff-filter=U`. Both
are already staged, and a `git commit` ships them.

**Resurrection.** Main added a file into a tree this branch deleted in full.
Git sees base-absent, ours-absent, theirs-present and stages a **clean add** -
it has no way to know the directory was deleted on purpose. `merge-state.sh`
reports these as `RESURRECTED`. Each one is either ported to the new layout or
`git rm --cached`'d, and the count must reach zero before the merge commits.

**Silent port-or-drop.** The `DU` set above, once someone has "resolved" it.

**Directory-rename ports.** The mirror image, and this one is a gift rather than
a trap. Where your branch *created* a tree (`enterprise/`, absent from both base
and theirs), git's directory-rename detection maps their new files onto your new
paths and reports them `UA` with stage 3 byte-identical to their original. That
is the port, already proposed — accepting it is right, and dropping it loses
their work. What it does **not** carry is imports: the file arrives with the old
tree's `~/…` specifiers, which resolve to nothing. Count them before and after.

**Half-landed features, delivered by the clean merge.** The worst class, because
nothing marks it at all. A feature of theirs that spans ten files conflicts in
three; the other seven merge clean and land whole. So you get test files
asserting a field no schema declares, a method body calling helpers this branch
does not import, a `const` that only the conflicted hunk defined. After
resolving an area, grep the cleanly-merged files for symbols that do not exist:

```bash
# every symbol imported from a module, against what that module now exports
grep -rn 'from "\./helpers/thing"' <area> ...
```

The lesson generalises: **the conflict list is not the review surface.** Before
committing, diff the merge result against your own branch and read what arrived.

## 5. Ask what main changed, not what differs

The instinct is to diff ours against theirs. That shows the restructuring too -
thousands of lines of moved code - and buries main's actual change in it.
Diff **base against theirs**:

```bash
git diff :1:path/to/file :3:path/to/file      # what main did, alone
git diff :1:path/to/file :2:path/to/file      # what we did, alone
git show :3:path/to/file                      # theirs in full (only stage for UA)
```

Their change is usually small and portable. Read it, then apply that change to
our file by hand.

**Triage formatting out first.** A branch that reformatted (tabs to spaces, a
different print width) differs from theirs on every line, and the conflict looks
enormous when there is nothing in it. Ask how big each side's change really is:

```bash
git diff -w --numstat :1:path :2:path   # ours, whitespace-blind
git diff -w --numstat :1:path :3:path   # theirs, whitespace-blind
```

Ours near zero means **take theirs and re-run the formatter** — there is nothing
of ours to lose, and hand-merging would only re-litigate line wrapping. That one
check turned 13 files of apparent conflict into one mechanical decision.

**When both sides are real, the rule for a restructuring branch is:
ours is the structure, theirs is the feature.** Keep our import paths, our time
source, our port objects and our logging seam; take their semantics whole. Never
take a side wholesale — that is how a feature or a restructuring gets reverted.

**When their feature needs data our port does not carry**, extend the port
rather than dropping the feature or reaching around it. Prefer an optional
member when many hand-built doubles implement it, and say in the doc what an
absent value degrades to.

## 6. Order: unblock the verifier first

Nothing is verifiable while a shared prebuild is broken, and conflict markers
are a syntax error. A marker in one package that others' declarations build
from fails **every** typecheck in the repo with `TS1185` before it reaches any
package - so the first task is always to find and clear that chain, not to
start at the top of the conflict list.

```bash
git grep -l '^<<<<<<< ' -- packages modules   # the prebuild inputs first
```

The same holds one level down, and it costs a whole area if you miss it: a
marker in one service is a syntax error, so **every test that imports it cannot
even be collected**. An area reading "0 tests, all suites failed" usually means
one unresolved module at the root of its import graph, not that the area is
broken. Resolve the roots and the suites come back.

**Verify by running, not by typechecking.** `vitest` needs no declarations
prebuild, so a package can be proven green while the tree as a whole still will
not compile — that is how anything gets verified at all while a shared prebuild
is down. A typecheck that dies in the prebuild never reached your code and says
nothing about it; do not report it as a failure of the work.

Running is also the only thing that finds the half-landed class above. Every
defect this skill's author introduced by hand was caught by executing the code
and none by reading it.

## 7. Five things never to do

- **Never `git add` a directory while anything under it still holds markers.**
  It stages unresolved work as resolved *and* destroys that file's `:1:/:2:/:3:`
  stages, so the method in step 5 is gone for every file it touched. Stage by
  explicit pathspec, per file, as each one is finished. `merge-state.sh` reports
  the damage as `STAGED-UNRESOLVED`; the repair is to rebuild the three stages
  from `merge-base` / `HEAD` / `MERGE_HEAD` and feed them to
  `git update-index --index-info` (the conflict markers themselves record the
  other side's path, which is what makes the rebuild possible).
- **Never blanket-resolve a directory.** `git checkout --theirs -- <dir>` and
  `git add -A` are how both silent classes got staged in the first place.
- **Never delete a file to clear a type error.** That is a revert wearing the
  costume of a fix, and it will read as finished forever.
- **Never trust rerere across machines.** The cache does not transfer, so the
  same merge yields far more conflicts elsewhere. That is the honest number:
  every extra conflict is one a cache was answering without being read.
- **Never resolve a decision that is the human's.** Where a file should live,
  and whether to port an unrelated feature now, are theirs. Ask, and keep
  working on everything that does not depend on the answer.

## 8. Snapshot before you risk anything

A partial merge exists only in one working tree's index. It survives nothing -
not a crashed session, not a machine.

Do **not** snapshot by committing the merge. Committing clears `MERGE_HEAD`,
and with it every `:1:`/`:2:`/`:3:` stage - the method in step 5 is gone and
cannot be recovered without redoing the merge. Write the snapshot through a
throwaway index instead, so the live merge is untouched:

```bash
IDX=$(mktemp) && cp .git/index "$IDX"
GIT_INDEX_FILE="$IDX" git add -A .                 # resolves stages in the COPY
TREE=$(GIT_INDEX_FILE="$IDX" git write-tree)
SNAP=$(git commit-tree "$TREE" -p HEAD -p "$(cat .git/MERGE_HEAD)" \
         -m "[skip ci] partial merge snapshot")
git update-ref refs/heads/wip/merge-partial-$(date +%F) "$SNAP"
git push -u origin wip/merge-partial-$(date +%F)
```

The commit keeps **both parents**, so it records the merge, and markers are
committed with it - that is the point, it is a snapshot and not a result.
Verify `MERGE_HEAD` is still present afterwards. To continue from one anywhere:

```bash
git fetch origin wip/merge-partial-<date>
git merge origin/main                                   # fresh, real conflicts
git checkout FETCH_HEAD -- <paths already finished>     # per path, never a dir
```

Take the snapshot before any wide or destructive step, and whenever a session
is about to end with work in the index.

## 9. Lanes share one index

The merge lives in a single working tree, so merge lanes **cannot run in
parallel** the way module lanes do - two agents staging into one index will
interleave resolutions. Run them one at a time, or give each a disjoint path
prefix and collect between them. The coordinator's three-lane ceiling does not
apply here; one is the ceiling.

Decompose by area, not by count: an area whose conflicts share a cause
(a rename, a moved package, a renamed export) is one lane and one decision
repeated. Write the manifest with the cause in it, not just the file list.

## 10. Before you stop

Rewrite `.claude/handoffs/merge-<area>.md` as a snapshot, under 150 lines, and
put the live numbers in it by running step 1 rather than recalling them. The
handoff carries what the next session cannot recompute: which decisions the
human has already made, which `DU` files were ported and where, and which
resolutions were judgement calls worth re-reading.

## Done when

`merge-state.sh` reports zero unmerged, zero markers and zero `RESURRECTED`;
the merge result has been diffed against our own branch and read; the blocked
verifier from step 6 runs clean; and every decision reserved in step 7 has an
answer recorded in the handoff.
