# CodeRabbit Validation — DO NOT MERGE

Smoke-test PR for issue #3754. Every file in this directory intentionally
violates one of the new CodeRabbit / semgrep / ast-grep / GitHub Action
rules so we can confirm each rule fires in the wild.

This branch must never be merged. The PR title carries `[DO NOT MERGE]`.
Once the smoke test produces verdicts for each rule, the PR is closed
and the verdicts are linked back into PR #4162's description.

## File-to-rule mapping

| File | Rule expected to fire |
|---|---|
| (none — see filename below) | `${...}` structural guard (path-name rule) |
| `langwatch/src/pii-in-logger-violation.ts` | semgrep `pii-in-logger-call` |
| `langwatch/src/pii-literal-api-key-violation.ts` | semgrep `pii-literal-api-key` |
| `langwatch/src/syntactic-violations.ts` | ast-grep `no-explicit-any`, `no-inline-dynamic-import`, `no-localhost-fallback` |
| `langwatch/src/components/FormWatchInChildViolation.tsx` | ast-grep `no-form-watch-in-child` |
| `langwatch/src/export-star-shim-violation.ts` | ast-grep `no-export-star-shim` |
| `langwatch/src/judgment-violations.ts` | path_instructions: tRPC Zod missing, class component, service→component import |
| `langwatch/src/server/clickhouse/migrations/9999_qualified_table_violation.sql` | semgrep `clickhouse-no-qualified-table` |
| `langwatch/src/server/migrations/9999_irreversible_violation.sql` | path_instructions: migration not reversible |
| `langwatch/src/big-file-violation.ts` | path_instructions: file > 300 lines (SRP) |

The `${...}` guard is tested by a separate commit that adds a file at
the literal path `coderabbit-validation/${UNEXPANDED}/leak.txt`.

The deployment-impact GH Action is exercised by the PR description
omitting the `## Deployment Impact` section — the workflow should fail
the PR check.
