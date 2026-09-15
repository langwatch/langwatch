---
name: residue
description: "Find residue — the half of a refactor that never got deleted. Sweeps a scope (a package, an application, a module, the whole repository) for code that survives only because nothing ever forced its removal: files nothing imports, files reachable only from their own tests, compatibility shims left at an old address after a move, one concept declared under two names in two generations, shrink-only budgets whose slack quietly un-enforces them, and guards that read a baseline file which no longer exists. Runs the mechanical detector (dev/scripts/find-residue.mjs) first, then the reading passes no script can do: parallel folders doing one job, migrations announced in comments and never finished, specs tagged @unimplemented years ago, manifests and handovers describing a drive that stopped. Every finding names a file, a line, and what would break if it were deleted — leads with evidence, never a delete list. Use whenever someone says 'half-finished refactor', 'leftover', 'abandoned', 'throwaway work', 'never deleted', 'dead code', 'is this still used', 'can I delete this', 'what is left over from the X migration', 'this folder looks like it can go', 'two ways of doing the same thing', or before a cleanup drive picks its targets."
user-invocable: true
argument-hint: "<package path, application, module name, or nothing for the whole repository>"
---

# Find residue

Residue is the second half of a refactor that nobody did. The first half — writing the
new shape — gets reviewed and merged. The second half — deleting what the new shape
replaced — needs someone to *notice*, and nothing in the toolchain notices. `tsc` is
happy: the old generation still compiles. The suite is happy: the old generation still
has its own tests, and they still pass. Lint is happy: it was baselined years ago. So
both generations sit in the tree, and the next reader cannot tell which one they are
meant to extend.

Every finding answers one question mechanically — **if this were deleted, what would
break?** — and reports the cases where the honest answer is "only the thing that exists
to keep it alive."

You produce **leads with evidence**. You do not delete anything. A finding that a human
cannot check in thirty seconds from the evidence you attached is not finished.

## The order, always

**1. Run the detector.** It is fast (about 2.5 seconds over 15,000 files) and it is the
floor, not the ceiling.

```bash
node dev/scripts/find-residue.mjs                    # whole repository
node dev/scripts/find-residue.mjs apps/worker        # one subtree
node dev/scripts/find-residue.mjs --only test-only,orphan modules/trace
node dev/scripts/find-residue.mjs --json             # for ranking and grouping
```

It self-tests on every run and refuses to report if the self-test fails, because the one
thing worse than no detector is one that reports clean because it cannot see.

**2. Read `references/reading-passes.md`** and do the passes there. They cover what an
import graph structurally cannot know: two folders doing one job, a migration announced
in a comment and abandoned, a spec tagged `@unimplemented` and forgotten, a lint baseline
that is the last thing on earth referencing a dead file.

**3. Confirm each lead before you report it.** `references/reading-passes.md` has the
confirmation recipes. A lead you did not confirm is a guess with a file path attached.

**4. Report.** Format at the bottom of this file.

## What the detector reports

| Detector | The shape | Confidence |
| --- | --- | --- |
| `orphan` | Nothing imports it and it is not an entry point. Deleting it breaks nothing at all. | High |
| `test-only` | Reachable from its own tests and from nowhere else. The signature shape of an abandoned generation: the code is dead, it came with a unit test, and the test keeps both of them green. The suite is what proves the code is needed, and the suite is the only thing that needs it. | High |
| `re-export` | A module that forwards `export … from "./sibling"`. The shim left at the old address by a move whose consumers were never updated — which CLAUDE.md bans outright. A package's own declared entry is exempt: that is its public surface. | High |
| `twin` | One exported name declared in two files of one package, where neither imports the other and the name is not published from both. Two spellings of one concept, old and new, both still live. | **Lead only** |
| `slack-ratchet` | A shrink-only budget whose stored number sits far above what the file now measures. The cleanup happened; the guard meant to lock it in was never re-measured, so the file may silently regrow. A ratchet with slack in it is not a ratchet. | High |
| `dangling-guard` | A policy that reads a baseline file which does not exist, so it enforces nothing while looking like it does. | High |

`twin` is the one detector that generates leads rather than findings. Triage it **last**,
and only where it co-occurs with another signal on the same file or the same concept. A
package with 100 twins has a naming convention; a file with one twin and an `orphan` on
the other side has an unfinished move.

## What the detector cannot see

Stated plainly so you never present its output as a complete answer:

- **It reads import specifiers, not the type checker.** A file reached only through a
  string — a path built at runtime, a glob of migrations, a worker spawned by filename —
  reads as an `orphan`. Check before believing.
- **It resolves relative paths and workspace `@langwatch/*` entries, and nothing else.**
- **It cannot see intent.** Two live generations where the new one is half-built is the
  most valuable thing to find and the detector will not name it. That is pass 1 of the
  reading passes, and it is the one worth your time.

## Report format

Group by confidence, not by directory. Under each finding:

```
<detector>  path/to/file.ts:LINE
  What it is:    one sentence.
  Kept alive by: the exact thing — a test file, a baseline entry, a barrel line, nothing.
  If deleted:    what breaks, named. "Nothing" is a valid and strong answer.
  Confirmed by:  the command you ran, so the reader can repeat it.
```

Close with what you did **not** find. A scope that came back clean is a real result and
saying so plainly is worth more than padding the list with `twin` leads.

## The discipline

- **Never delete.** Not even something with zero importers. You report; a human decides.
  The one thing an import graph cannot rule out is the consumer it cannot see.
- **Never widen the scope you were given.** A whole-repository sweep is a different job
  from "look at the worker" and produces a different, less useful report.
- **Report a negative result as a result.** "The detector is right that `apps/api` is
  clean, and here is why the folder you suspected is live" is a finding.
- **Do not confirm the asker's priors.** People point at the folder that *feels* messy.
  It is frequently not the one holding the residue. Say so, with the evidence.
