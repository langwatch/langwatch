# `.coderabbit/`

CodeRabbit configuration ancillary files. The root config is `/.coderabbit.yaml`.

## `ast-grep/rules/`

Deterministic syntactic rules (issue #3754 AC3). Each `.yml` is one rule;
CodeRabbit auto-loads everything in this directory via `reviews.tools.ast-grep.rule_dirs`.

`language: TypeScript` does not match `.tsx` files in ast-grep's parser
dispatch, so rules that apply to both file types are split into `_ts` /
`_tsx` siblings.

| Rule | Forbids | Scope |
|---|---|---|
| `no-explicit-any.yml` + `no-explicit-any-tsx.yml` | `: any`, `as any` (predefined_type kind with regex `^any$`) | `langwatch/src/**/*.{ts,tsx}` |
| `no-inline-dynamic-import.yml` + `-tsx.yml` | Inline `import(...)` outside `routes.tsx` / `pages/**` | `langwatch/src/**/*.{ts,tsx}` |
| `no-form-watch-in-child.yml` | `$form.watch()` inside a child component receiving `form` as prop | `langwatch/src/components/**/*.tsx` |
| `no-export-star-shim.yml` + `-tsx.yml` | `export * from "..."`. Inline-disable with `// ast-grep-ignore: no-export-star-shim-{ts,tsx}` | `langwatch/src/**/*.{ts,tsx}` |
| `no-localhost-fallback.yml` + `-tsx.yml` | `?? "http://localhost..."` and template-literal variants | `langwatch/src/**/*.{ts,tsx}` |
| `no-form-disable-on-isvalid.yml` | `disabled={!form.formState.isValid}` / `disabled={!isValid}` on submit buttons — pre-disable is silent. See `dev/docs/design/guidelines.md` § 6. | `langwatch/src/**/*.tsx` |

All rules `severity: warning` for sprint 1 (phased rollout — promote to
`error` per-rule once baseline is verifiably clean).

## Testing — every rule is proven by a fixture

`sgconfig.yml` + `rule-tests/` make `ast-grep test` prove each rule actually
matches real code. This harness exists because #3754 shipped a **dead** rule
(`no-form-watch-in-child` fired on nothing); "looks right" is not enough.

```bash
# from .coderabbit/ast-grep/ :
ast-grep test -c sgconfig.yml -t rule-tests       # all rules must pass
ast-grep test -c sgconfig.yml -t rule-tests -U    # regenerate snapshots after a rule edit
```

Each `rule-tests/<id>-test.yml` lists `valid:` (must NOT match) and `invalid:`
(MUST match) snippets; `rule-tests/__snapshots__/` pins the exact matches.
`/.github/workflows/coderabbit-config-check.yml` runs this on every PR touching
the config (pinned ast-grep + `semgrep --validate` + a semgrep match check), so
a dead or malformed rule fails CI.

**Adding a rule:** drop the `.yml` in `rules/` (matching the
[ast-grep rule schema](https://ast-grep.github.io/guide/rule-config.html), unique
id, split `_ts` / `_tsx` if it applies to both), add a `rule-tests/<id>-test.yml`
with ≥1 `valid` + ≥1 `invalid` snippet, run `ast-grep test … -U` to record the
snapshot, and commit all of it. No fixture = the rule is unproven.

## Related

- `/.coderabbit.yaml` — root config; references this directory.
- `/.semgrep/langwatch.yml` — semantic patterns (PII regex, ClickHouse
  TenantId enforcement, heavy-column dedup anti-pattern).
- `/.github/workflows/deployment-impact-check.yml` — AC5 deployment-surface
  guard (moved out of CodeRabbit because `path_instructions` can't see PR
  descriptions).
- `dev/docs/best_practices/`, `dev/docs/design/`, `dev/docs/adr/` — house
  style sources, included in `knowledge_base.code_guidelines.filePatterns`
  so CR can cite them in review comments.
