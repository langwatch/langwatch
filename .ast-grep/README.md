# `.ast-grep/`

Deterministic syntactic lint rules for this repo. **These are a linter, not AI
configuration.** They run as an ordinary CI gate and from your shell:

```bash
make lint-rules          # scan the whole repo
make lint-rules-changed  # scan only what this branch changed (what CI gates on)
make lint-rules-test     # prove every rule still matches its fixture
```

They used to live under `.coderabbit/`, which framed them as review-bot config
and meant nothing ever executed them against real code — only CodeRabbit did,
once per PR, as a comment. They now sit next to `/.semgrep/` as a first-class
ruleset. CodeRabbit still reads them via `reviews.tools.ast-grep.rule_dirs` in
`/.coderabbit.yaml`, but it is one consumer, not the gate.

`language: TypeScript` does not match `.tsx` in ast-grep's parser dispatch, so
rules that apply to both file types are split into `_ts` / `_tsx` siblings.

## Rules

| Rule | Forbids | Scope |
|---|---|---|
| `no-explicit-any` + `-tsx` | `: any`, `as any` | `langwatch/src/**/*.{ts,tsx}` |
| `no-inline-dynamic-import` + `-tsx` | inline `import(...)` outside `routes.tsx` / `pages/**` | `langwatch/src/**/*.{ts,tsx}` |
| `no-form-watch-in-child` | `$form.watch()` in a child receiving `form` as a prop | `langwatch/src/components/**/*.tsx` |
| `no-export-star-shim` + `-tsx` | `export * from "..."`. Disable inline with `// ast-grep-ignore: no-export-star-shim-{ts,tsx}` | `langwatch/src/**/*.{ts,tsx}` |
| `no-localhost-fallback` + `-tsx` | `?? "http://localhost..."` and template-literal variants | `langwatch/src/**/*.{ts,tsx}` |
| `no-form-disable-on-isvalid` | `disabled={!form.formState.isValid}` on submit buttons | `langwatch/src/**/*.tsx` |
| `require-bdd-describe-context` + `-tsx` | nested `describe` that names a topic instead of a `given`/`when` condition | test files under `langwatch/**`, `typescript-sdk/**` |
| `require-boolean-name-prefix` | `foo: boolean` without an `is`/`has`/`should`/`can`/`will` prefix or a domain-adjective equivalent | `langwatch/{src,ee}/**/*.ts` |
| `require-fetch-timeout` + `-tsx` | `fetch(...)` with no `signal` — a hung peer hangs the caller | `langwatch/src/**`, `typescript-sdk/src/**` |
| `no-test-without-assertion` + `-tsx` | a test whose inline body contains no `expect`/`assert` — passes unless the code throws | test files |
| `use-action-based-test-name` + `-tsx` | `it("should …")`, and names carrying no behaviour (`works`, `renders`, `test`) | test files |
| `no-tautological-assertion` + `-tsx` | `expect(X).toBe(X)` — an assertion that cannot fail | test files |
| `no-empty-test` + `-tsx` | `it("…", () => {})` — always green, counts as coverage | test files |

The BDD/boolean/fetch trio was added because they were the three largest
mechanically preventable clusters in a 50-PR sample of CodeRabbit comments —
the BDD one alone accounted for 32 findings. The four test-quality rules target
the second-largest cluster (45 findings): tests that cannot fail. Measured
across `src`, `ee` and `packages`: 171 `should`/vague names, 20 tautological
assertions, 10 assertion-free tests.

Biome covers the rest of the test surface — `noFocusedTests`,
`noSkippedTests`, `noDuplicateTestHooks`, `noMisplacedAssertion`,
`noExportsInTest`, `useTestHooksOnTop`, `noExcessiveNestedTestSuites` — scoped
to test files in `langwatch/biome.jsonc`. Unscoped, `noFocusedTests` fires on
any function named `fit(...)`, including a production zoom hook. Each rule that moves here should be **deleted**
from `path_instructions` in `/.coderabbit.yaml`, or every violation gets
reported twice, once deterministically and once probabilistically.

All rules are `severity: warning` during rollout. Promote per-rule to `error`
once its baseline is verifiably clean.

## Every rule is proven by a fixture

`sgconfig.yml` + `rule-tests/` make `ast-grep test` prove each rule actually
matches real code. This harness exists because #3754 shipped a **dead** rule
(`no-form-watch-in-child` fired on nothing); "looks right" is not enough.

```bash
ast-grep test -c sgconfig.yml -t rule-tests       # all rules must pass
ast-grep test -c sgconfig.yml -t rule-tests -U    # re-record snapshots after a rule edit
```

Each `rule-tests/<id>-test.yml` lists `valid:` (must NOT match) and `invalid:`
(MUST match) snippets; `rule-tests/__snapshots__/` pins the exact matches.

**Adding a rule:** drop the `.yml` in `rules/` ([rule schema](https://ast-grep.github.io/guide/rule-config.html)),
unique id, split `_ts` / `_tsx` if it applies to both; add
`rule-tests/<id>-test.yml` with ≥1 `valid` + ≥1 `invalid`; run
`ast-grep test … -U` to record the snapshot; commit all of it. No fixture = the
rule is unproven.

## Related

- `/.semgrep/langwatch.yml` — semantic patterns (PII regex, ClickHouse TenantId,
  heavy-column dedup anti-pattern).
- `/.coderabbit.yaml` — the AI reviewer; consumes `rules/`, and carries the
  judgement-level rules that genuinely cannot be expressed syntactically.
- `langwatch/biome.json` — the TypeScript linter proper. Rules expressible as
  Biome config belong there, not here.
