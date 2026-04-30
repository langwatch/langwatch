# Audit brief — features

You are an audit soldier. Goal: classify every `@unimplemented` scenario in `specs/features/`.

## Read this first
- Plan doc: orchard-codex/plans/unimpl-reduction-2026-04-25.md (in the orchard-codex repo)
- Existing tracking issue: https://github.com/langwatch/langwatch/issues/3458

## Your contract

For every occurrence of `@unimplemented` in `specs/features/`, append a row to a new file at `specs/features/AUDIT_MANIFEST.md`:

```markdown
| File | Scenario | Class | Rationale |
|------|----------|-------|-----------|
| specs/features/foo.feature | "Open the modal" | KEEP | Behavior still exists, no test bound |
```

Classes: KEEP / UPDATE / DELETE / DUPLICATE.

- KEEP — scenario describes intended behavior, write a test (Phase 3)
- UPDATE — behavior changed, scenario must be rewritten before binding
- DELETE — aspirational/stale, remove from spec
- DUPLICATE — already covered elsewhere; reference the duplicate

## Convergence test (ralph-loop)

Manifest is COMPLETE when the row count equals the `@unimplemented` count exactly:

```bash
mc=$(awk '/^\| specs\//' specs/features/AUDIT_MANIFEST.md | wc -l)
uc=$(grep -rh '@unimplemented' specs/features/ | wc -l)
[ "$mc" -eq "$uc" ] && echo "AUDIT COMPLETE"
```

## Process

1. Read every `.feature` file in `specs/features/`.
2. For each `@unimplemented` scenario, **read surrounding code/tests** to make a judgment — do NOT just classify everything KEEP. Use git log, grep, and read the actual implementation.
3. Append rows to `specs/features/AUDIT_MANIFEST.md` as you go.
4. When manifest count matches @unimplemented count, commit + open a PR titled "audit(features): classify @unimplemented scenarios (#3458)".
5. PR body = TL;DR breakdown by class + link to plan doc.

## Rules

- Branch is `audit/unimpl-features-2026-04-25` (already checked out).
- Do not modify any `.feature` file in this PR — manifest only. Phase 1 soldiers will execute the actions.
- /effort max from session start.
- One PR per domain. Drive via /ralph-wiggum:ralph-loop with --completion-promise 'AUDIT COMPLETE' --max-iterations 20.
