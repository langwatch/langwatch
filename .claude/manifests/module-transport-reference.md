# Manifest: module-transport-reference

Objective: Split the transport half out of `extend.md` into its own reference,
and give the homeless code-shape rules in `lane-brief.md` a canonical home in
`module/SKILL.md`.
Owner: fable-lane-2
Model: fable   - the split points are decided and named by line number; this is
moving prose and updating a routing table. No design decisions.
Budget: 50 tool calls
Handoff: .claude/handoffs/module-transport-reference.md

## Owned paths

```
.claude/skills/module/SKILL.md
.claude/skills/module/references/extend.md
.claude/skills/module/references/transport.md      (new - you create it)
dev/docs/plans/lane-brief.md
```

Nothing else.

## Shared paths - stop and request

```
.claude/skills/module/references/convert.md    UNCOMMITTED in-flight edits   do not touch
.claude/skills/module/references/new.md        UNCOMMITTED in-flight edits   do not touch
.claude/skills/core/**                         canonical                     coordinator
.claude/coordinator/**                         canonical                     coordinator
```

`convert.md` and `new.md` carry another ruling's uncommitted work. Do not open
them for editing. Reading them is fine.

## Read-only reference paths

```
.claude/skills/module/references/wire.md    a sibling reference - match its shape and length
.claude/skills/core/repository-rules.md     where the operating rules already live
.claude/skills/core/testing-rules.md        section 9 already owns wire-compatibility
```

## Target shape

### Task 1 - split the transport half out of extend.md

`extend.md` is 447 lines. Its structure today:

```
  0. Locate the owner and its shape      line  10
  1. Spec                                line  27
  2. Contract                            line  34
  3. Server                              line  46
  4. Web                                 line  69
  5. Composition                         line  83
  6. Adding a REST endpoint              line  93   <- moves, with 6.1 to 6.5
  7. Adding a tRPC procedure             line 248   <- moves, with 7.1 to 7.5
  8. Gates                               line 426
     Report                              line 441
```

Sections 6 and 7 are 333 of the 447 lines and are a different task from the rest:
they are the repetitive per-route and per-procedure declaration work.

Move sections 6 and 7 **verbatim** into a new
`.claude/skills/module/references/transport.md`, renumbered as sections 1 and 2
of that file with their subsections renumbered to match (6.1 becomes 1.1, 7.3
becomes 2.3, and so on). Give it a short intro of about five lines saying what
it covers and that `extend.md` covers the rest of extending a module. Keep its
own Gates and Report lines if the moved text has them, otherwise point back at
`extend.md`'s.

`extend.md` keeps sections 0 to 5, 8 and Report, renumbered so the sequence has
no gap, and gains a line where section 6 used to be:

```markdown
Adding a REST endpoint or a tRPC procedure is `references/transport.md`.
```

Fix every internal cross-reference the renumbering breaks, in both files. Grep
both for `section 6`, `section 7`, `6.`, `7.` and any `extend.md#` anchor before
you finish.

### Task 2 - routing table in module/SKILL.md

`module/SKILL.md` has a "What are you doing -> read which reference" table. Add a
row for the new reference, immediately after the `extend.md` row:

| Adding a REST endpoint or a tRPC procedure to a module that already exists | `references/transport.md` |

and narrow the `extend.md` row's wording so it no longer claims the REST
endpoint and tRPC procedure cases - those words move to the new row. Change
nothing else in that file except Task 3 below.

**Do not touch the frontmatter.** The `description` names 'add a
mutation/column/filter/endpoint/procedure' and must keep naming them - the skill
still covers this work, it just routes it to a different file.

### Task 3 - rehome the code-shape rules

`dev/docs/plans/lane-brief.md` lines 76 and 78 carry code-shape rules that no
canonical file owns:

```
no `as never`, no `ctx: unknown`, no non-null `!`, no inline import(),
folders at most twelve files, no file under twenty lines
```

These are module code-shape rules, so their home is `module/SKILL.md`, in the
"What a lane may and may not do" section, folded into the existing bullet that
already reads "No re-exports, no `as unknown as`, no `as PrismaClient`, no
`try*`/`require*` methods, ...". Extend that bullet rather than adding a new one.

Two of them are already canonical elsewhere and must NOT be copied into
`module/SKILL.md` - leave them where they are and simply delete them from
`lane-brief.md`:

- the inline `import()` ban is in the root `CLAUDE.md`;
- `@scenario` annotation binding is in `.claude/skills/core/testing-rules.md`
  section 8.

Then delete the rehomed clauses from `lane-brief.md` and, if that leaves the
sentence stranded, replace it with a pointer:

```markdown
Code-shape rules are in `.claude/skills/module/SKILL.md`.
```

## Invariants

- Frontmatter of `module/SKILL.md` unchanged, character for character.
- Section 6 and 7 text lands in `transport.md` verbatim - same commands, same
  code blocks, same paths. Only the section numbers change.
- No rule is lost. Every clause you remove from `lane-brief.md` exists somewhere
  afterwards, and you say where in the handoff.
- `convert.md` and `new.md` are not modified.
- No application source touched. No git write commands.
- British English, no em dashes - write " - " instead.
- Do not read any `.env` or `settings.local.json`.

## Checks

Markdown only - no test, typecheck or lint.

```
wc -l .claude/skills/module/SKILL.md .claude/skills/module/references/extend.md .claude/skills/module/references/transport.md
grep -nE '^#{2,3} ' .claude/skills/module/references/extend.md .claude/skills/module/references/transport.md
grep -n 'section [67]\|as never\|ctx: unknown' .claude/skills/module/references/*.md dev/docs/plans/lane-brief.md
git status --porcelain          # ONLY the four owned paths dirty by you
git diff --stat -- .claude/skills/module/references/convert.md .claude/skills/module/references/new.md   # must be UNCHANGED from before you started
```

Also run a line-survival check: every substantive line of `extend.md` at HEAD
must still exist in `extend.md` or `transport.md` afterwards, except the section
headings you renumbered. Report the count of anything missing.

## Stop conditions

- a shared path is needed;
- `convert.md` or `new.md` turn out to need editing;
- the budget is reached;
- this manifest turns out to be wrong.

## Completion criteria

- `transport.md` exists, holds the old sections 6 and 7 verbatim, renumbered 1
  and 2, with a short intro.
- `extend.md` is roughly 120 to 140 lines, sections renumbered with no gap, and
  points at `transport.md`.
- `module/SKILL.md`'s routing table has a `transport.md` row and the `extend.md`
  row no longer claims REST endpoints and tRPC procedures.
- `module/SKILL.md`'s code-shape bullet carries `as never`, `ctx: unknown`,
  non-null `!`, the twelve-file folder budget and the twenty-line file floor.
- `lane-brief.md` no longer states any of them.
- No cross-reference anywhere still says "section 6" or "section 7" meaning the
  moved transport sections.
- `convert.md` and `new.md` byte-identical to how you found them.
