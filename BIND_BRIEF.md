# Phase 3 — KEEP-binding soldier brief (per-domain)

**Date**: 2026-04-26
**Trigger**: Drew 2026-04-26T00:03Z "feature with matching tests to close the gap" + 09:03Z "Yes [proceed Phase 3]. Also test failing on main? Investigate. Delegate. Make promises."
**Parent plan**: `~/workspace/orchard-codex/plans/unimpl-reduction-2026-04-25.md`
**Phase 1 status**: 10 cull PRs landed in draft (#3467-3476).

## Your job (one soldier per domain)

You are a Phase 3 KEEP-binding soldier. Resume your domain's `audit/unimpl-<DOMAIN>-2026-04-25` branch (Phase 1 cull already landed there). Bind every KEEP-classified `@unimplemented` scenario in `specs/<DOMAIN>/AUDIT_MANIFEST.md` to a matching test.

**Branch is already checked out.** Worktree is `~/workspace/langwatch/.worktrees/audit-<DOMAIN>`. Manifest at `specs/<DOMAIN>/AUDIT_MANIFEST.md`.

## Contract — per KEEP row

For each row classified `KEEP`:

1. Find the canonical implementation/code path the scenario describes.
2. Find or write a test that exercises that behavior.
3. **Bind** the scenario to the test using the project's binding mechanism (typically `@scenario('<scenario name>')` JSDoc tag on the test). Reference Phase 0 commits and existing bindings on main as examples.
4. Remove the `@unimplemented` tag from the scenario in the .feature file.
5. Verify the parity check (if quickly runnable) accepts the binding.
6. Commit per ~25 bindings (so reviewable diffs).

## Rules

- **No code changes outside `specs/<DOMAIN>/` and the test files you bind to.** Do not touch other domains' specs.
- **No changes to app/source code.** If a scenario describes behavior the code doesn't implement, mark the manifest row `(NEEDS-CODE)` in `BIND_NOTES.md`, leave the scenario tagged `@unimplemented`, and continue with the next row. Do NOT write the implementation.
- **Run pnpm install only if you need to run tests** — most binding work is just adding `@scenario` JSDoc to existing test files. If you can verify by static analysis (test file imports + test name match), skip pnpm.
- One commit per ~25 bindings. Final commit message: `bind(<domain>): bind KEEP @unimplemented scenarios per manifest`
- Push to the same branch (already has upstream from Phase 0+1).
- Update the PR title to `bind(<domain>): apply Phase 3 binding (#3458)` and refresh the body.
- Mark PR ready-for-review (drop draft) ONLY when all KEEP rows are addressed (bound or marked NEEDS-CODE).
- /effort max from session start.
- Drive via `/ralph-wiggum:ralph-loop --completion-promise 'BINDING COMPLETE' --max-iterations 30`.

## Convergence test

```bash
DOMAIN=<your-domain>
cd ~/workspace/langwatch/.worktrees/audit-$DOMAIN
keep_total=$(awk '/^\| specs\//' specs/$DOMAIN/AUDIT_MANIFEST.md | awk -F'|' '$4 ~ /KEEP/' | wc -l)
unimpl_left=$(grep -rh '@unimplemented' specs/$DOMAIN/ | wc -l)
needs_code=$([ -f BIND_NOTES.md ] && grep -c '(NEEDS-CODE)' BIND_NOTES.md || echo 0)
update_count=$(awk '/^\| specs\//' specs/$DOMAIN/AUDIT_MANIFEST.md | awk -F'|' '$4 ~ /UPDATE/' | wc -l)
echo "Bound: $((keep_total - needs_code))"
echo "Pending NEEDS-CODE (manifest review): $needs_code"
echo "Remaining @unimplemented in spec tree: $unimpl_left (should equal $((needs_code + update_count)))"
```

You're done when:
1. Every KEEP row in the manifest is either bound (test added with @scenario tag) or logged in BIND_NOTES.md as `(NEEDS-CODE)` with rationale
2. The `@unimplemented` count in `specs/<DOMAIN>/` equals `NEEDS-CODE_count + UPDATE_count` (UPDATE rows are out of scope for this phase)
3. Commits pushed, PR title + body updated
4. State the promise phrase `BINDING COMPLETE`

## Reporting cadence

Drew on Telegram, orchardist watching. Only ping orchardist if:
- Blocker (build break, missing test directory, can't find binding mechanism)
- Mass-failure pattern (e.g. 50 KEEP rows in a row are all NEEDS-CODE)
- Completion (state `BINDING COMPLETE`)

Otherwise commit + push + iterate.

## Safety

- Never modify another domain's specs or tests outside the binding work.
- Do not implement missing code — flag NEEDS-CODE and continue.
- Do not modify the manifest itself (it's the audit record).
- If a KEEP row's scenario name doesn't match any obvious test or code path after a reasonable search, mark NEEDS-CODE and move on. Don't speculate.
