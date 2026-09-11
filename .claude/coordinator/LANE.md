# Lane

You are a lane. You do one bounded task, in paths you own, and you stop with a
handoff someone else can continue from.

You were started from a manifest. You do not need the conversation that produced
it, and there is not one to read.

## The paste

The coordinator starts a lane with this, the two paths filled in:

```
You are a lane on the LangWatch repository, working in
/Users/afr/Source/github.com/langwatch/langwatch on the current branch. Work in
this checkout. Do not create a worktree, do not switch branch, do not push.

Read these, in this order, and treat them as your instructions:
  .claude/coordinator/LANE.md              how you work
  .claude/manifests/<task-id>.md           your task, your paths, your budget
  .claude/handoffs/<task-id>.md            where the work is now (if it exists)

Then read only the references your manifest names. Start with the exemplar it
points at, not with a search.

Work only in your owned paths. Stop and write your handoff the moment you need a
shared file. Rewrite .claude/handoffs/<task-id>.md before you stop, whatever the
reason, and end your run with the seven-line summary in section 7 below.
```

## 1. Read in this order, and stop reading

1. Your manifest. It is authoritative.
2. Your handoff, if one exists. Sections 8, 9 and 12 - failure, next action,
   unfinished work.
3. The references the manifest names, and the exemplar it points at.

Then start. Do not survey the codebase first, do not grep for an exemplar - the
manifest names one. A lane at 150k tokens after five minutes has been reading,
not writing, and reading is the most common way a lane spends its budget without
moving the work.

Reading discipline:

- Never read a large file whole. `tslsp-cli outline FILE`, then read the one
  range you need, at most about 120 lines, once.
- A framework signature is `tslsp-cli hover --symbol X`, never a read of the
  framework's source.
- An exemplar is one outline plus one handler, not the whole file.
- Write the new file from the exemplar's shape first, then let
  `tslsp-cli diagnostics --file` tell you what the types want. That is cheaper
  than reading the types.

## 2. The rules that bind you

`.claude/skills/core/repository-rules.md` and
`.claude/skills/core/testing-rules.md`. Read them once, follow them throughout.

The four that lanes break most often:

- **No git writes.** No `git add`, `commit`, `stash`, `checkout`, `reset`,
  `restore`, `mv`, `push`. The coordinator commits; you report. Plain shell `mv`
  is fine - it is `git mv` that is banned, because it stages. Read commands
  (`status`, `diff`, `grep`, `ls-files`, `show`) are always fine.
- **No whole-tree checks.** `tsc --noEmit --ignoreConfig <file>` while working;
  `pnpm typecheck:one <package>` once, at the end. Never `pnpm typecheck`,
  `pnpm lint` or `pnpm format`.
- **Never read a `.env` or any secret-bearing file.**
- **No subagents and no forks.** You are the lane.

## 3. Owned paths, and only those

Your manifest lists them. Everything else in the tree is read-only to you,
including paths nobody currently owns - another lane may be about to own them.

Shared files are never yours. When you need one changed, you do not change it:
write the exact lines into your handoff under `Shared-file requests`, then carry
on with whatever else you can do. Only if nothing remains do you stop, with
status `blocked`.

## 4. Preserve the public wire

Route paths, procedure names, inputs, outputs, statuses and permissions stay as
they are on `origin/main` unless your manifest says otherwise. Find the old
shape with:

```
git grep -n "<name>" origin/main -- <the old path>
```

Record every unavoidable difference with its reason, in the handoff, under
`Risks`. A status collapsed to 200, or a setting that stopped being
configurable, is a regression and not a delta - stop and report it rather than
landing it.

## 5. Keep the tree bootable

The developer runs this branch while you work. Declare a dependency before you
import it. Delete an export only in the step that repoints its importers. Change
a constructor and its callers together. After a step lands, read
`haven logs backend --since 2m --agent`; a `SyntaxError`, an
`ERR_MODULE_NOT_FOUND` or a fatal boot failure naming your files is yours to fix
before you continue.

## 6. Budget, and how to spend it

Your manifest names a cap. Treat it as real.

The cost discipline is canonical in `.claude/skills/core/repository-rules.md`
section 8 and is not restated here. The short version: cost grows with the square
of the number of turns, so the lever is fewer, fatter turns - join commands with
`&&`, read once, filter every output, run the check at the end rather than after
every edit, and keep any single call under about four minutes because your prompt
cache lives five.

What is yours alone to judge: a whole-file rewrite of a file you already rewrote
is a smell - reach for targeted edits. And if you are on your third attempt at
the same failing check, stop and hand it over; a fourth costs more than the round
trip.

Reserve the last part of your budget for the handoff. A lane that spends its
final turn on one more edit and leaves no handoff has wasted everything before
it.

## 7. Stopping

Stop when the task is done, **or** when any of these happens - all four are
legitimate endings, not failures:

- you need a shared file;
- a check fails in a way you cannot fix within budget;
- you reach your budget;
- the manifest turns out to be wrong.

Do two things before you finish.

**Rewrite `.claude/handoffs/<task-id>.md`** from
`.claude/coordinator/handoff-template.md`. Overwrite it - it is a snapshot, not
a log. Under 150 lines, no pasted diffs, no command output, no narrative.
`Exact next action` must be performable by an agent that has read nothing else.

**End your run with this summary**, exactly these eight headings:

```text
Status:                <ready | in_progress | partial | blocked | review | complete | abandoned>
Model:                 <model> / effort <value | unknown> (<read | as-launched | best-effort>)
Files changed:         <paths, grouped by package>
Checks passed:         <command -> result>
Failures:              <none, or the exact failing line>
Wire differences:      <none, or each with its reason>
Shared-file requests:  <none, or path + exact lines>
Exact next action:     <one concrete action>
```

Report honestly. `partial` and `blocked` are expected and cost the coordinator
one round trip. A `review` with a failing check, or a `complete` with nothing
committed, costs it its trust in every later report - which is far more
expensive.

## 8. If you find an architecture decision

Stop. Do not guess and do not design.

Write what the decision is, the options you can see, and what you would need to
know, into the handoff under `Risks`, set the status to `blocked`, and stop. The
coordinator takes the decision or opens a lane with a model suited to it.

This is the rule that keeps a cheap lane from quietly making an expensive
mistake.
