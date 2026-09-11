# Handoff: skills-progressive-disclosure

Status: review
Manifest: .claude/manifests/skills-progressive-disclosure.md
Updated: 2026-09-11 (attempt 1)

## 1. Identity

Task skills-progressive-disclosure, lane fable-lane-1, first attempt. No prior
handoff existed.

## 2. Objective

Split `module-review` into a routing `SKILL.md` plus `references/`, document the
new `.claude/` layout in its README, and repoint the two strict-feature-layout
drive documents at the canonical mechanism in `.claude/coordinator/` and
`.claude/skills/core/`, keeping only drive-specific content.

## 3. Owned paths

```
.claude/skills/module-review/SKILL.md
.claude/skills/module-review/references/**
.claude/README.md
dev/docs/plans/coordinator-prompt.md
dev/docs/plans/lane-brief.md
```

## 4. Shared paths - do not edit

```
.claude/skills/core/**
.claude/coordinator/**
.gitignore
```

## 5. Work completed

- `module-review/SKILL.md` is 93 lines: frontmatter byte-identical to HEAD
  (verified by `diff` of lines 1 to 6), the when-it-applies paragraphs, the
  five-step order, a routing table, eight invariants, and section 8 (classify
  and report) kept in full as the final report format.
- `references/review-checklist.md` (sections 1 to 4), `references/parity.md`
  (sections 5 and 6) and `references/over-abstraction.md` (section 7) were
  produced by `sed` line ranges from the working-tree file and proven identical
  to those ranges with `diff`, so the text moved unchanged. Each starts with a
  one-line owner pointer at the `module-review` skill.
- Both uncommitted channels blocks survive: the `Channels:` bullet is
  `review-checklist.md` lines 66 to 76, the "Where does a conduit stop?" bullet
  is `over-abstraction.md` lines 16 to 19. `grep -c channel`: 5 and 2.
- Every non-blank line of the HEAD version of the skill is present in the union
  of the four new files except three lines that were edited only to
  disambiguate a path (see Risks).
- `.claude/README.md` documents `coordinator/`, `manifests/`, `handoffs/`,
  `skills/core/`, both `references/` directories, and the symlink finding in
  the manifest's words (no `skillDirectories` or `additionalDirectories` in
  `.claude/settings.json`, verified by grep).
- `coordinator-prompt.md` (78 lines) and `lane-brief.md` (118 lines) open with a
  header naming the canonical files and keep only drive content: the
  baseline-row table and exemplars, where a thing lives, the wire pin with its
  `git grep` recipe, the drive's code-shape rules, the module-specific test
  exemplars, the drive-specific handoff additions, the counters, the manifest
  additions for this drive, and the module queue.

## 6. Files changed

.claude
- modified: `.claude/README.md`
- modified: `.claude/skills/module-review/SKILL.md`
- added: `.claude/skills/module-review/references/review-checklist.md`
- added: `.claude/skills/module-review/references/parity.md`
- added: `.claude/skills/module-review/references/over-abstraction.md`

dev/docs/plans
- modified: `dev/docs/plans/coordinator-prompt.md`
- modified: `dev/docs/plans/lane-brief.md`

## 7. Checks completed

- `diff <(git show HEAD:SKILL.md | sed -n 1,6p) <(sed -n 1,6p SKILL.md)` -> identical
- `diff` of each `sed` range against the tail of its reference -> identical (all three)
- `wc -l` -> SKILL.md 93; review-checklist 142; parity 48; over-abstraction 41
- `git diff --stat -- .claude/skills/module-review/SKILL.md` -> 48 insertions, 213 deletions
- `grep -c channel` -> SKILL.md 1, review-checklist 5, over-abstraction 2, parity 0
- `grep -n "service-does-not-open-a-channel\|Where does a conduit stop"` -> both found
- line-survival loop (every HEAD line `grep -Fxq` against the union) -> only the three deliberate path edits absent
- `grep -n "—"` on all six files -> none
- `git status --porcelain` -> owned paths dirty; the other dirty entries under `.claude/` and `dev/docs/` predate this lane or are the coordinator's untracked protocol directories

No test, typecheck or lint was run: markdown only, as the manifest says.

## 8. Current failure

none

## 9. Exact next action

Coordinator: read `.claude/skills/module-review/SKILL.md` once (93 lines) to
confirm the routing table reads well, then commit the slice by pathspec:
`git ls-files --others --exclude-standard .claude/skills/module-review/references`
plus the four tracked paths in section 6. Do not commit `.claude/coordinator/`,
`.claude/skills/core/`, `.claude/handoffs/` or `.claude/manifests/` in this
slice unless that is intended; they are untracked and were not this lane's.
Do not re-run the channels ruling's edits: both blocks are already in the
references.

## 10. Shared-file requests

none

## 11. Risks

- Three lines of the skill were edited rather than moved, all path
  disambiguations forced by the new `references/` directory: the intro's
  `references/testing.md` is now `.claude/skills/architecture-guide/references/testing.md`;
  section 8's `references/convert.md` is now `.claude/skills/module/references/convert.md`;
  section 7's "See section 5 above" is now "See `parity.md` section 5".
- Section 8 (classify and report) stayed in `SKILL.md` rather than moving to
  `over-abstraction.md`: the manifest names it both ways, and keeping it is what
  lands `SKILL.md` inside the 90 to 130 line window. `over-abstraction.md`
  therefore carries section 7 only.
- Details dropped from the drive documents that the canonical files do not
  carry, for the coordinator to decide whether `core/` or `COORDINATOR.md`
  wants them: the spawn mechanics (Agent tool, `subagent_type
  general-purpose`, prompt "Read and follow <path> exactly"); the reason behind
  the four-minute tool-call cap (the prompt cache lives five minutes); "run
  that package's own check once" before committing a slice (COORDINATOR.md
  section 8 covers the integration check, not the package check).
- The old INSPECT cadence (15, 45 and 90 minutes, 120 shell calls) was removed
  as superseded, not merely duplicated: COORDINATOR.md section 1 replaces
  timer polling with event-based checkpoints and manifests carry the budget.
- `lane-brief.md` keeps a `git grep` before deleting an export, phrased as a
  complement to `tslsp-cli references` (it catches the two blind spots
  `repository-rules.md` section 5 names), so it does not contradict core.
- `lane-brief.md` keeps the code-shape rules (`as never`, `ctx: unknown`,
  non-null `!`, folder and file size budgets) because no canonical file carries
  them; if they belong in `module/SKILL.md` instead, that is a separate change.
- `module-review` section 6 says a skill change under `.claude/skills/` wants a
  matching scenario in `specs/skills/skills-testing.feature`; no scenario names
  `module-review` today and `specs/` is not an owned path, so none was added.

## 12. Unfinished work

none

## 13. Completion status

All three tasks landed and every manifest completion criterion is met; the
checks in section 7 back the claim. Nothing is committed - the coordinator
commits the slice.
