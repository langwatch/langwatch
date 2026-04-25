# Audit brief — bundle tail-b

You are an audit soldier handling a bundle of small spec domains:

**Domains in this bundle:** typescript-sdk evaluators batch-evaluation-results

Goal: classify every `@unimplemented` scenario across all listed domains, ONE manifest per domain.

## Read this first
- Plan doc: /home/boxd/workspace/orchard-codex/plans/unimpl-reduction-2026-04-25.md
- Tracking issue: https://github.com/langwatch/langwatch/issues/3458
- Sequencing: Option B — same branch evolves through cull (Phase 1) and tests (Phase 3); manifest deleted in final commit before merge.

## Your contract

For every occurrence of `@unimplemented` in EACH listed domain, append a row to that domain's manifest at `specs/<DOMAIN>/AUDIT_MANIFEST.md`:

```markdown
| File | Scenario | Class | Rationale |
|------|----------|-------|-----------|
| specs/home/foo.feature | "Open the modal" | KEEP | Behavior still exists, no test bound |
```

Classes: KEEP / UPDATE / DELETE / DUPLICATE.

- KEEP — scenario describes intended behavior, write a test (Phase 3)
- UPDATE — behavior changed, scenario must be rewritten before binding
- DELETE — aspirational/stale, remove from spec
- DUPLICATE — already covered elsewhere; reference the duplicate

## Manifests to produce

- `specs/typescript-sdk/AUDIT_MANIFEST.md` (one row per @unimplemented in `specs/typescript-sdk/`)
- `specs/evaluators/AUDIT_MANIFEST.md` (one row per @unimplemented in `specs/evaluators/`)
- `specs/batch-evaluation-results/AUDIT_MANIFEST.md` (one row per @unimplemented in `specs/batch-evaluation-results/`)

## Convergence test (ralph-loop)

Bundle is COMPLETE when every domain's manifest row count >= that domain's @unimplemented count:

```bash
all_done=true
for d in typescript-sdk evaluators batch-evaluation-results; do
  if [ ! -f "specs/$d/AUDIT_MANIFEST.md" ]; then all_done=false; break; fi
  mc=$(awk '/^\| specs\//' "specs/$d/AUDIT_MANIFEST.md" | wc -l)
  uc=$(grep -rh '@unimplemented' "specs/$d/" | wc -l)
  [ "$mc" -ge "$uc" ] || { all_done=false; break; }
done
$all_done && echo "AUDIT COMPLETE"
```

## Process

1. For each domain in the bundle: read every `.feature` file in `specs/<DOMAIN>/`.
2. For each `@unimplemented` scenario, **read surrounding code/tests** to make a real judgment — don't classify everything KEEP. Use git log, grep, and read the actual implementation.
3. Append rows to that domain's `AUDIT_MANIFEST.md` as you go.
4. When all manifests in the bundle satisfy convergence, commit + open a DRAFT PR titled "audit(tail-b): classify @unimplemented scenarios (#3458)".
5. PR body = TL;DR breakdown by domain + class.

## Rules

- Branch is `audit/unimpl-tail-b-2026-04-25` (already checked out).
- DO NOT modify any `.feature` file in this PR — manifests only. Phase 1 soldiers will execute the actions on this same branch.
- /effort max from session start.
- Drive via /ralph-wiggum:ralph-loop with --completion-promise 'AUDIT COMPLETE' --max-iterations 30.
- Open the PR as DRAFT (--draft flag on gh pr create).
