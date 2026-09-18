---
name: resync
description: "Resync every teaching surface with dev/docs/ARCHITECTURE.md after rulings land in the record: CLAUDE.md, .claude/skills/*, dev/docs/best_practices/*, and the dev docs. The record is the single source of truth; this skill walks the surfaces that teach from it and removes drift — stale vocabulary, dead method names, superseded shapes, examples that no longer compile. Use after a design session amended the record, after a wave lands that renames vocabulary, or whenever a skill/doc is caught teaching something the record has overruled."
user-invocable: true
argument-hint: "[surface to resync, or blank for all]"
---

# Resync the teaching surfaces with the record

`dev/docs/ARCHITECTURE.md` is THE record — rulings land there first, in the
same change that makes them (that rule lives in memory and in the record
itself). Everything else that *teaches* — CLAUDE.md, skills, best-practices
docs — is a derived surface and drifts. This skill is the sweep that brings
them back.

## What is a teaching surface (sync these)

- `CLAUDE.md` — the workspace instructions, especially its command tables and
  the Common Mistakes rows that name vocabulary.
- `.claude/skills/*/SKILL.md` (+ their `references/`) — every skill that
  quotes a chain, a class name, a file path, or a code example.
- `dev/docs/best_practices/*.md` — pattern docs whose examples name real
  seams.
- `dev/docs/CODING_STANDARDS.md`, `dev/docs/TESTING_PHILOSOPHY.md` — only
  where they cite concrete vocabulary, not their principles.

## What is NOT a teaching surface (never touch)

- `dev/docs/adr/**` — ADRs are immutable history. A superseded ADR is
  superseded by a new ADR or by the record, never edited.
- `specs/**` — feature files are requirements with binding tags; changing one
  is feature work, not a resync.
- Generated files, `dev/docs/plans/**` handovers (they are snapshots), and
  git history.

## The procedure

1. **Establish the delta.** `git log --oneline -20 -- dev/docs/ARCHITECTURE.md`
   and read every section those commits touched. The rulings in those diffs
   are the sync source. Do not re-derive rulings from memory or conversation —
   only what the record says counts.
2. **Inventory the drift.** For each ruling, grep the teaching surfaces for
   the vocabulary it replaced (the old names are in the record's own diffs —
   e.g. a ruling that killed `withStores` means grepping the surfaces for
   `withStores`). A surface that quotes a dead name, a dead path, or a
   superseded chain is drifted.
3. **Distinguish landed from ruled.** The record carries both what the tree
   does today and what was ruled but not yet built (§16-style "flipped"
   notes, "ruled 2026-…; the landed interim uses …" markers). A teaching
   surface must teach the CURRENT tree as fact and may name the ruled target
   as direction — never teach an unlanded ruling as if it were present, and
   never keep teaching a shape the record has overruled without saying so.
4. **Edit tightly.** Update the stale sentence, example, or table row to
   match the record's wording — reuse the record's own phrasing where it is
   short enough. Do not restructure a skill while resyncing it; drift removal
   and rewrites are different jobs.
5. **Report.** End with a table: surface → rulings applied → lines touched.
   A surface checked and found clean is listed as clean; silence is not
   evidence of a check.

## Known drift-prone rows

- CLAUDE.md's Common Mistakes rows that name method vocabulary
  (`withStores`, member names, per-store setters).
- `.claude/skills/backend/SKILL.md` — quotes the whole compose chain and the
  Server preamble; stale the moment either changes.
- `.claude/skills/frontend/SKILL.md` — screen/declaration mechanics.
- `dev/docs/best_practices/error-handling.md` — cites transport seams by
  name.

## Guardrails

- The record wins every conflict. If a surface disagrees with the record and
  the surface looks *right*, that is a finding to raise (the record may have
  a gap), not a licence to keep the surface — say so in the report instead
  of silently choosing.
- Never invent a ruling to fill a gap a surface exposes. Gaps go in the
  report.
- This skill edits prose and examples, never source code. If an example in a
  doc cannot be made truthful without a code change, mark it in the report.
