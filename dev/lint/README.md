# `dev/lint/`

The repo's semgrep ruleset, and the note on which kind of rule belongs where.

```
dev/lint/semgrep/langwatch.yml   two semantic rules      (make lint-rules)
dev/lint/semgrep/tests/          the PII rule's fixture   (make lint-rules-test)
```

## Where a rule belongs

| Kind of rule                                    | Home                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| Anything expressible over JavaScript/TypeScript | a langwatch oxlint rule, `packages/oxlint-rules` |
| A whole-tree fact (graph, ownership, cycles)    | `@langwatch/architecture-enforcer`               |
| A pattern over SQL migration files              | `dev/lint/semgrep/langwatch.yml`                 |
| Genuinely needs judgement                       | `path_instructions` in `/.coderabbit.yaml`       |

**There is one JavaScript and TypeScript linter, and it is oxlint.** `pnpm lint`
runs it with the langwatch plugin; every langwatch rule is `error`, fixture-tested
under `packages/oxlint-rules/tests/rules/`, bound to a scenario under
`specs/tooling/`, and listed in the generated `dev/docs/lint-rules.md`. The
`lint-rule` skill is how to add one. Formatting is oxfmt's, configured in
`/.oxfmtrc.json`.

The ast-grep ruleset that used to live here is gone. What it caught that was
still worth catching is an oxlint rule now: `no-form-watch-in-child`,
`require-fetch-timeout`, `no-tautological-assertion`. The ClickHouse rules that
were semgrep's are oxlint rules too: `clickhouse-tenant-id` and
`clickhouse-no-version-order-limit`, over every `repositories/clickhouse/` file
of every module.

## The semgrep ruleset

Two rules, each there because oxlint cannot hold it:

| Rule                            | Why semgrep                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `pii-in-logger-call`            | CodeRabbit loads it (`reviews.tools.semgrep.config_file`) and cites it in review |
| `clickhouse-no-qualified-table` | it reads `.sql` migrations, which oxlint does not parse                          |

`code-scanners.yml` runs the ruleset diff-scoped and report-only;
`coderabbit-config-check.yml` proves it parses and that the PII rule still
matches its fixture. The version is pinned in both and in the `Makefile`.

## Configs that cannot move to this folder

| File                | Why it cannot move                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/.coderabbit.yaml` | CodeRabbit reads the repository root only                                                                                                              |
| `/.gitleaks.toml`   | `gitleaks` itself takes `--config`, but CodeRabbit's gitleaks tool exposes only `enabled`, so a moved allowlist silently stops applying to reviews     |
| `/.golangci.yml`    | discovered by walking up from the linted package; not finding it means default linters, not an error                                                   |
| `/.dockerignore`    | build-context root. A per-Dockerfile `<name>.dockerignore` works, but six Dockerfiles build from this context and a forgotten one ships `node_modules` |

A rule in more than one home gets reported twice — once deterministically and
once probabilistically — which trains people to skim review threads. **When a
rule moves into a linter, delete it from `path_instructions`.**
