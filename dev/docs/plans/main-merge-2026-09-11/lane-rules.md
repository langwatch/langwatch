# Rules for a merge lane

Every merge-area manifest points here. Read this once; it is the part that is the
same for all of them, and most of it was learned the expensive way during the
`docs/` pilot.

## 1. You make no git writes

None. No `git add`, `commit`, `merge --continue`, `merge --abort`, `checkout
--ours/--theirs`, `restore`, `stash`, `rm`, `mv`. The coordinator stages and
commits; you edit files.

Read commands are all fine and you will need them:

```
git show :1:<path>   the merge base
git show :2:<path>   OURS  (this branch)
git show :3:<path>   THEIRS (origin/main)
git diff --ours <path> / --theirs <path>
git log <base>..origin/main -- <path>     what main did, and why
```

To restore a file, write it back with your editor from `git show :2:<path>`.

## 2. `git status` will keep saying `UU` for files you have finished

Only `git add` clears an unmerged path and that is the coordinator's half. It is
not a sign your work did not land. Your evidence is: no conflict markers, and the
content is right.

## 3. A file with no conflict markers is not necessarily resolved

`rerere` is enabled here with 2,755 cached resolutions and replays a previous
merge attempt's answers automatically. Across the tree it answered 199 content
conflicts; **195 were good blends and 3 silently dropped main's work.**

So for a conflicted file that has no markers:

```
git show :2:<f> > /tmp/ours ; git show :3:<f> > /tmp/theirs
cmp -s /tmp/ours <f> && echo "TOOK OURS - read this one"
```

A replayed answer identical to **ours** is the dangerous one - "took ours" is the
resolution that discards main's change without a trace, and it is what
half-reverted six PRs the last time this branch merged main. Identical to theirs,
or a blend, is almost always fine.

Do **not** re-resolve every marker-less file by hand. That is the work rerere
just saved. Check them, fix the ones that took ours, say what you found.

## 4. The rule for every resolution

> Main's change either lands somewhere, or it is dropped **with a stated reason**.

"Took ours" is a decision, not a resolution, and it gets a line in your handoff
saying what main was doing and why it no longer applies. This is the single thing
this merge is designed around.

## 5. Never conclude "main removed it" or "we don't have it" from a filename grep

This cost the `docs/` pilot two reversals. Main renames whole areas:
`optimization-studio/` became `workflows/`, `better-agents/` became `skills/`,
`ai-gateway/cli/` became `coding-agents/`. Grepping `origin/main` for the old name
returns nothing and looks exactly like deletion.

Before saying a thing is gone, search for **what it does**, not what it is called:
grep the content, the exported symbol, the route, the type name. For docs, check
the `redirects` table in `docs/docs.json` - main records its own renames there.

## 6. modify/delete (`UD`), the category that resolves against instinct

Main deleted a file this branch modified. Find where main put the content, then:

- main has a replacement -> our edit goes there if it still applies, and the file
  stays deleted;
- main removed the capability outright -> the file stays deleted, and you say so;
- the feature still exists on this branch and main has nothing -> **stop and ask.**
  Do not decide that one alone.

Before spending an hour carrying an edit across, measure it with `git diff -w`:
in the pilot, "400 lines of our documentation" was 230 lines ignoring whitespace
and most of the rest was reformatting.

## 7. deleted-by-us (`DU`), the mirror

This branch deleted the file; main modified it. Almost always the branch rewrote
that code elsewhere and main's change is superseded - but "almost always" is not
"always", and this is where main's new features hide. Check whether main's change
is a **new capability** (a new export, error class, status, endpoint) or an edit to
something the rewrite already covers. A new capability needs a home; an edit does
not.

## 8. added-by-them (`UA`)

Main added a file into a directory this branch restructured. Git cannot place it.
Mechanical once you know the destination, and your manifest names it. If a file
has no sensible destination in the new layout, record it - do not invent one.

## 9. Generated files are not merged, they are regenerated

Lockfiles, OpenAPI documents, `llms-full.txt`, snapshot fixtures. Leave them
conflicted and name them in the handoff with the command that rebuilds them.

## 10. Stop cleanly

These areas are large and partial is expected. Resolve **whole files** - never
leave one half-done - and say exactly which paths are finished and which are
untouched. A clean partial handoff is worth more than a rushed complete one,
because the next lane starts from it.
