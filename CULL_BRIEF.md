# Phase 1 — Cull soldier brief (per-domain)

**Date**: 2026-04-26
**Trigger**: Drew 2026-04-26T00:03Z "Get the federation working and all of the feature with matching tests to close the gap"
**Parent plan**: `~/workspace/orchard-codex/plans/unimpl-reduction-2026-04-25.md`
**Phase 0 status**: 10 domain manifests committed on `audit/unimpl-DOMAIN-2026-04-25` branches.

## Your job (one soldier per domain)

You are a Phase 1 cull soldier. Apply the DELETE + DUPLICATE actions from your domain's `AUDIT_MANIFEST.md`. Phase 3 KEEP-binding fires after this lands.

**Branch is already checked out.** Worktree is `~/workspace/langwatch/.worktrees/audit-<DOMAIN>`. Manifest lives at `specs/<DOMAIN>/AUDIT_MANIFEST.md`.

## Contract

Iterate the manifest rows. For each row:

| Class | Action |
|-------|--------|
| KEEP | leave the scenario alone (Phase 3 will bind) |
| UPDATE | leave the scenario alone (separate UPDATE wave will rewrite) |
| DELETE | remove the scenario (and its `@unimplemented` tag) from the `.feature` file. If the whole file becomes a single empty Feature, delete the file. |
| DUPLICATE | remove the scenario from this `.feature` file. The rationale column SHOULD name the canonical spec; if absent, log it in `CULL_NOTES.md` and remove anyway. |

## Rules

- **No code changes outside `specs/<DOMAIN>/`.** Do not touch tests, app code, or other domains.
- **Rebase on origin/main first** (`git fetch origin && git rebase origin/main`); if rebase has merge conflicts you cannot resolve, stop and report — do NOT force-merge.
- **No `pnpm install`** — you only read .feature files and edit them. Saves disk + RAM.
- One commit per ~50 scenarios removed (so the diff is reviewable).
- Final commit message: `cull(<domain>): remove DELETE+DUPLICATE @unimplemented scenarios per manifest`
- Push to the branch (it already has an upstream from Phase 0).
- Open / update the PR if not already open. PR title: `cull(<domain>): apply Phase 1 cull (#3458)`. Mark draft until Phase 3 lands.
- /effort max from session start.
- Drive via `/ralph-wiggum:ralph-loop --completion-promise 'CULL COMPLETE' --max-iterations 30`.

## Convergence test

```bash
DOMAIN=<your-domain>
cd ~/workspace/langwatch/.worktrees/audit-$DOMAIN
# All DELETE+DUPLICATE scenarios should be gone. Count remaining `@unimplemented` tags
# in DELETE+DUPLICATE rows of the manifest:
expected=$(awk '/^\| specs\//' specs/$DOMAIN/AUDIT_MANIFEST.md | awk -F'|' '$4 ~ /DELETE|DUPLICATE/' | wc -l)
# After cull, the @unimplemented count in specs/<domain>/ should drop by ~$expected.
# Ratchet by checking the manifest is referenced but the scenarios have moved out of feature files.
remaining_unimpl=$(grep -rh '@unimplemented' specs/$DOMAIN/ | wc -l)
echo "Manifest rows to cull: $expected"
echo "Remaining @unimplemented after cull: $remaining_unimpl"
```

You're done when:
1. Every DELETE / DUPLICATE row in the manifest has its corresponding scenario removed from the `.feature` file
2. The branch builds (no broken feature parsing — if you have `pnpm run build:specs` or similar, run it; otherwise eyeball the diff)
3. Commit + push + PR open (or refreshed if already open)
4. State the promise phrase `CULL COMPLETE` in your final response

## Reporting cadence

Drew is on Telegram. Orchardist is watching. You only ping orchardist if:
- You hit a blocker you can't resolve (rebase conflict, file format you don't understand, mass-failure on the same row pattern)
- You complete (state `CULL COMPLETE`)

Otherwise just commit + push + iterate. Orchardist watches via `tmux capture-pane` and `gh pr view`.

## Safety

- Never modify another domain's specs.
- Never delete a `.feature` file unless every scenario in it is being removed AND the file becomes empty after removal.
- If the manifest row's rationale conflicts with what the .feature file actually says (e.g. row says DELETE but the scenario looks legitimate), tag the row with `(NEEDS-REVIEW)` in `CULL_NOTES.md`, leave the scenario in the .feature file, and continue with the next row.
