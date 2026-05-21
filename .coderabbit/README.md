# `.coderabbit/`

CodeRabbit configuration ancillary files. The root config is `/.coderabbit.yaml`.

## `ast-grep/rules/`

Deterministic syntactic rules (issue #3754 AC3). Each `.yml` is one rule;
CodeRabbit auto-loads everything in this directory via `reviews.tools.ast-grep.rule_dirs`.

| Rule | Forbids |
|---|---|
| `no-explicit-any.yml` | `: any`, `as any` in `langwatch/src/**`. |
| `no-inline-dynamic-import.yml` | Inline `import(...)` in `.ts`/`.tsx` outside `routes.tsx` / `pages/**`. |
| `no-form-watch-in-child.yml` | `$form.watch()` inside a child component receiving `form` as prop. |
| `no-export-star-shim.yml` | `export * from "..."` outside `index.ts`/`index.tsx` barrels. |
| `no-localhost-fallback.yml` | `?? "http://localhost..."` and equivalents. |

All rules `severity: warning` for sprint 1 (phased rollout — promote to
`error` per-rule once baseline is verifiably clean).

Add new rules by dropping a `.yml` here matching the [ast-grep rule schema](https://ast-grep.github.io/guide/rule-config.html).
Keep rule IDs unique.

## Related

- `/.coderabbit.yaml` — root config; references this directory.
- `/.semgrep/langwatch.yml` — semantic patterns (PII regex, etc.).
- `/.github/workflows/deployment-impact-check.yml` — AC5 deployment-surface
  guard (moved out of CodeRabbit because `path_instructions` can't see PR
  descriptions).
