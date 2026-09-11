# Manifest: skills-progressive-disclosure

Objective: Give `module-review` the progressive disclosure every other task skill
already has, and repoint the two existing drive documents at the new canonical
workflow mechanism instead of restating it.
Owner: fable-lane-1
Model: fable   - the structure is decided; this is moving prose into references
and rewriting two documents to link rather than duplicate. No design decisions.
Budget: 60 tool calls
Handoff: .claude/handoffs/skills-progressive-disclosure.md

## Owned paths

```
.claude/skills/module-review/SKILL.md
.claude/skills/module-review/references/**        (new directory, you create it)
.claude/README.md
dev/docs/plans/coordinator-prompt.md
dev/docs/plans/lane-brief.md
```

Nothing else. Not application source, not `modules/`, not `apps/`, not the
top-level `skills/` directory (that is shipped product content, not agent
config).

## Shared paths - stop and request

```
.claude/skills/core/**          read-only, canonical, just written   coordinator
.claude/coordinator/**          read-only, canonical, just written   coordinator
.gitignore                                                           coordinator
```

If you believe one of these is wrong, write the exact lines into your handoff
under `Shared-file requests`. Do not edit them.

## Read-only reference paths

```
.claude/skills/core/repository-rules.md     the canonical operating rules
.claude/skills/core/testing-rules.md        the canonical test rules
.claude/skills/core/handoff-rules.md        the canonical handoff contract
.claude/coordinator/COORDINATOR.md          the coordinator protocol
.claude/coordinator/LANE.md                 the lane protocol
.claude/skills/module/SKILL.md              THE EXEMPLAR for task 1 - copy its shape
```

`module/SKILL.md` is 125 lines: frontmatter, a short statement of the shape, a
routing table of "you are doing X -> read reference Y", and the invariants. That
is the target for `module-review/SKILL.md`. Read it first.

## Target shape

### Task 1 - split `module-review`

`.claude/skills/module-review/SKILL.md` is 273 lines carrying eight numbered
sections inline. Split it the way `module` is split:

- `SKILL.md` keeps: the frontmatter **unchanged** (name, description,
  `user-invocable`, `argument-hint` exactly as they are - the description is
  what triggers the skill and must not be reworded), when the skill applies, the
  workflow order, a routing table pointing at the references, the handful of
  non-negotiable invariants, the final report format, and what the skill must
  not do. Aim for 90 to 130 lines.
- `references/` takes the detail. Suggested split, adjust if the content argues
  otherwise:
  - `review-checklist.md` - sections 1, 2, 3, 4 (mechanical pass, server shape
    and data scoping, contract, web)
  - `parity.md` - sections 5 and 6 (composition and wiring, specs and tests)
  - `over-abstraction.md` - sections 7 and 8 (what the detectors cannot see,
    classify and report)

**Move the text, do not rewrite it and do not shorten it.** Every rule, command,
detector, path and example that is in the file today must still be in the skill
afterwards, in one file or another. This is a relocation, not an edit pass. The
one thing you add is the routing table and a one-line pointer at the top of each
reference saying which skill owns it.

**Critical:** `module-review/SKILL.md` has uncommitted changes in the working
tree - roughly 15 added lines about **channels** (a `Channels:` bullet in the
server-shape section, and a "Where does a conduit stop?" bullet in the
over-abstraction questions). That is active in-flight work from another ruling.
It must survive the split intact, in whichever reference file it lands in. Run
`git diff -- .claude/skills/module-review/SKILL.md` first and confirm both
blocks are present in your output before you finish.

### Task 2 - `.claude/README.md`

Update the structure block and prose to describe what is now there:

- the new `coordinator/` directory (tracked - the workflow protocol),
- the new `handoffs/` and `manifests/` directories (runtime state, gitignored
  except their READMEs),
- `skills/core/` (not a skill - the canonical shared rules),
- `skills/module-review/references/`.

Keep the existing paragraph about `.agents/skills` being a compatibility
symlink, and extend it with the finding that it is **not** a Claude Code
discovery root: there is no `skillDirectories` or `additionalDirectories`
setting in `.claude/settings.json`, so Claude Code discovers project skills at
`.claude/skills/` only, and the symlink exists for the cross-tool `.agents/`
convention that LangWatch's own `langwatch skills install` command defaults to
(`~/.agents`). Say plainly that it cannot cause duplicate discovery as
configured, and that adding either setting is what would change that.

### Task 3 - the two drive documents

`dev/docs/plans/coordinator-prompt.md` and `dev/docs/plans/lane-brief.md`
currently carry both the *mechanism* (how agents are briefed, bounded, budgeted
and handed over) and the *content* of the strict-feature-layout drive (which
modules, which baseline rows, which exemplar commits, the counters).

Split that: the mechanism now lives in `.claude/coordinator/` and
`.claude/skills/core/`, and these two documents keep only what is specific to
the strict-feature-layout drive.

For each file: add a short header saying the mechanism is now canonical in
`.claude/coordinator/COORDINATOR.md` (or `LANE.md`) and
`.claude/skills/core/`, then **delete the passages that duplicate it** and keep
the drive-specific content. Concretely, the duplicated passages to remove are
the general forms of: no whole-tree typecheck or lint, never read `.env`, the
vitest and `VITEST_MAX_WORKERS` discipline, no git writes, the `commit-slice`
recipe, the cache-window and budget sections, the reading-budget section, the
generic report format, the shared-file list, and the British-English and style
list.

What stays, because it is this drive's content and exists nowhere else:

- the per-baseline-row table of target shapes and exemplar commits,
- the "Where a thing lives" section (schemas, errors and types in the contract),
- the wire-pinned-to-`origin/main` instruction with the `git grep` recipe,
- the test-harness section's module-specific exemplars,
- the module queue and counters in `coordinator-prompt.md`,
- "the shape comes from the reference" pointer to `architecture-guide` and
  `module`.

Where a removed passage had a repository-specific detail the canonical file does
not carry, keep that one detail rather than dropping it - and note it in your
handoff under `Risks` so the coordinator can decide whether it belongs in
`core/`.

## Invariants

- Frontmatter of `module-review/SKILL.md` is unchanged, character for character.
  Rewording a `description` changes when the skill triggers.
- No guidance is lost anywhere. Every rule survives in some file. You are moving
  and de-duplicating, never deleting a rule outright.
- The uncommitted channels edits survive.
- No application source is touched. No file outside the owned list is written.
- No git write commands at all - no add, commit, stash, checkout, restore.
- British English, no em dashes - write " - " instead.
- Do not read any `.env` or `settings.local.json`.

## Checks

This task changes only markdown, so there is no test or typecheck to run. Verify
by reading:

```
wc -l .claude/skills/module-review/SKILL.md .claude/skills/module-review/references/*.md
git diff --stat -- .claude/skills/module-review/SKILL.md
grep -c "channel" .claude/skills/module-review/SKILL.md .claude/skills/module-review/references/*.md
git status --porcelain          # confirm ONLY the owned paths are dirty
```

Do not run `pnpm typecheck`, `pnpm lint` or any test suite - nothing here is
code.

## Stop conditions

- a shared path is needed;
- the content argues for a different reference split than the one suggested and
  you are unsure (say so and proceed with your best split - note it in the
  handoff);
- the budget is reached;
- this manifest turns out to be wrong.

## Completion criteria

- `module-review/SKILL.md` is between 90 and 130 lines with frontmatter intact.
- `module-review/references/` holds the detail, split into focused files, each
  with a one-line owner pointer at the top.
- Both uncommitted channels blocks are present somewhere in the skill.
- `.claude/README.md` documents `coordinator/`, `handoffs/`, `manifests/`,
  `skills/core/` and the symlink finding.
- Neither `coordinator-prompt.md` nor `lane-brief.md` still states a rule that
  `.claude/skills/core/` or `.claude/coordinator/` now states; both link to it
  instead; both keep their drive-specific content.
- `git status --porcelain` shows no dirty file outside the owned paths.
