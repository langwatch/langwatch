# Handoff: module-transport-reference

Status: review
Manifest: .claude/manifests/module-transport-reference.md
Updated: 2026-09-11 (first attempt)

## 1. Identity

Task `module-transport-reference`, lane fable-lane-2, attempt 1. No previous
handoff existed.

## 2. Objective

Split the transport half (old sections 6 and 7) out of `extend.md` into
`transport.md`, route it from `module/SKILL.md`, and rehome the homeless
code-shape rules from `lane-brief.md` into `module/SKILL.md`.

## 3. Owned paths

```
.claude/skills/module/SKILL.md
.claude/skills/module/references/extend.md
.claude/skills/module/references/transport.md      (new)
dev/docs/plans/lane-brief.md
```

## 4. Shared paths - do not edit

```
.claude/skills/module/references/convert.md    UNCOMMITTED in-flight edits   untouched
.claude/skills/module/references/new.md        UNCOMMITTED in-flight edits   untouched
.claude/skills/module/references/wire.md       read-only sibling             untouched
.claude/skills/core/**                         canonical                     untouched
.claude/coordinator/**                         canonical                     untouched
```

## 5. Work completed

- `transport.md` created (353 lines): a 9-line intro, then HEAD `extend.md`
  lines 93-424 verbatim as sections 1 (REST, 1.1-1.5) and 2 (tRPC, 2.1-2.5),
  then `## Gates` and `## Report` pointing back at `extend.md`. `diff` against
  the HEAD block shows exactly 15 changed lines: 12 headings, `step 6.3` ->
  `step 1.3`, `section 6 above` -> `section 1 above`, and `(section 2 above)`
  -> `` (`extend.md` section 2) `` (it referred to extend.md's Contract
  section, which is no longer "above").
- `extend.md` cut to 116 lines: sections 0-5 unchanged in substance, the
  pointer line `Adding a REST endpoint or a tRPC procedure is
  `references/transport.md`.` where section 6 stood, Gates renumbered 8 -> 6,
  Report kept. Cross-references fixed: intro (lines 6-8), the Transport bullet
  in section 3, the closing line of section 5. One pre-existing wrong pointer
  fixed on the way: section 3's peer-token sentence said "(section 8)" but
  meant Composition, now "(section 5)".
- `module/SKILL.md`: routing table row for `references/transport.md` added
  directly after the `extend.md` row; the `extend.md` row no longer names REST
  endpoints or tRPC procedures. Code-shape bullet now carries `as never`,
  `ctx: unknown`, non-null `!`, folders at most twelve files, no file under
  twenty lines. Frontmatter byte-identical to HEAD.
- `lane-brief.md`: the six rehomed clauses deleted from the "Code rules that
  fail review in this drive" sentence; the sentence keeps the clauses with no
  other home (no re-exports, `as unknown as` with its Prisma-double exception,
  `try*` names, `{ ok, error }` returns, ksuid ids) and gains the pointer
  `Code-shape rules are in `.claude/skills/module/SKILL.md`.`
- Where each removed clause lives now: `as never`, `ctx: unknown`, non-null
  `!`, twelve-file folders, twenty-line floor -> `module/SKILL.md` code-shape
  bullet; inline `import()` -> root `CLAUDE.md` (already canonical, not
  copied); `@scenario` kept bound -> `core/testing-rules.md` section 8
  (already canonical, not copied).

## 6. Files changed

```
.claude/skills/module/SKILL.md                     modified (2 hunks mine, see Risks)
.claude/skills/module/references/extend.md         modified
.claude/skills/module/references/transport.md      added
dev/docs/plans/lane-brief.md                       modified (1 hunk mine, see Risks)
```

## 7. Checks completed

- wc -l -> SKILL.md 132, extend.md 116, transport.md 353, lane-brief.md 116
- grep headings extend.md -> 0,1,2,3,4,5,6 Gates, Report (no gap)
- grep headings transport.md -> 1, 1.1-1.5, 2, 2.1-2.5, Gates, Report
- grep 'section [67]|as never|ctx: unknown' references/*.md lane-brief.md ->
  only convert.md:207, wire.md:49, wire.md:54 (not mine, see section 10)
- diff HEAD extend.md 93-424 vs transport.md 11-342 -> 15 lines, all listed above
- line-survival (every non-blank HEAD extend.md line present in
  extend.md+transport.md) -> 23 absent, all 13 renumbered headings + the 10
  rewritten cross-reference lines; 0 substantive lines missing
- frontmatter SKILL.md lines 1-6 vs HEAD -> identical
- git diff --stat convert.md new.md -> 27 / 11 insertions, unchanged from start
- grep em dash in all four files -> 0
- git status --porcelain on owned paths -> M, M, ?? transport.md, M

## 8. Current failure

none

## 9. Exact next action

Coordinator: apply the three one-line shared-file edits in section 10, then
commit the four owned paths by pathspec. Before committing `SKILL.md` and
`lane-brief.md`, read Risks: both carried another ruling's uncommitted edits
before this lane started, so a pathspec commit sweeps those in too.

## 10. Shared-file requests

```
.claude/skills/module/references/wire.md
  line 49: replace  Details: `references/extend.md` section 7.
           with     Details: `references/transport.md` section 2.
  line 54: replace  `references/extend.md` section 6.
           with     `references/transport.md` section 1.

.claude/skills/module/references/convert.md   (in-flight; apply when its owner lands)
  line 207: replace  (see `references/extend.md` section 6.3 for the current mount shape; the older
            with     (see `references/transport.md` section 1.3 for the current mount shape; the older
```

## 11. Risks

- `SKILL.md` and `lane-brief.md` were already dirty (uncommitted, another
  ruling) when this lane began; `git diff` on them is mostly that work. Mine
  is exactly: the two routing-table rows, the code-shape bullet, and the
  "Code rules that fail review in this drive" paragraph in lane-brief.md.
- `SKILL.md` line 33 still reads "extending a module with a new REST route
  that nobody mounts yet is `extend.md` for the route and `wire.md` for the
  family". The manifest said change nothing else in that file, so it stands;
  the one-line fix is `transport.md` for `extend.md` in that sentence.
- `extend.md` landed at 116 lines, under the manifest's rough 120-140: the cut
  is exact (447 - 333 + 2), nothing was trimmed beyond sections 6 and 7.
- The `(section 2 above)` line inside the moved block was reworded to
  `` (`extend.md` section 2) `` - the only non-numeric change in the verbatim
  block, and unavoidable since section 2 now means tRPC in transport.md.

## 12. Unfinished work

1. Apply section 10 to `wire.md` (2 lines) and, once its owner lands,
   `convert.md` (1 line).
2. Optional: fix `SKILL.md` line 33 as described in Risks.

## 13. Completion status

Objective fully landed in the owned paths and every manifest check passes;
ready for review and commit, with three one-line cross-reference fixes
outstanding in files this lane does not own.
