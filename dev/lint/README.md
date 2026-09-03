# `dev/lint/`

The repo's own lint rulesets — the ones written here rather than configured in
a package manifest — plus the note on which kind of rule belongs where.

```
dev/lint/ast-grep/   syntactic rules  (make lint-rules)
dev/lint/semgrep/    semantic rules   (make lint-rules)
```

Both are invoked by explicit path (`ast-grep -c`, `semgrep --config`), so
neither depends on sitting at the repo root. Four sibling configs do, and stay
there for reasons worth knowing before you try to tidy them away:

| File                | Why it cannot move                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/.coderabbit.yaml` | CodeRabbit reads the repository root only                                                                                                              |
| `/.gitleaks.toml`   | `gitleaks` itself takes `--config`, but CodeRabbit's gitleaks tool exposes only `enabled`, so a moved allowlist silently stops applying to reviews     |
| `/.golangci.yml`    | discovered by walking up from the linted package; not finding it means default linters, not an error                                                   |
| `/.dockerignore`    | build-context root. A per-Dockerfile `<name>.dockerignore` works, but six Dockerfiles build from this context and a forgotten one ships `node_modules` |

## The ast-grep ruleset used to be CodeRabbit's

It lived under `.coderabbit/ast-grep/`. That framing was the problem: filed
under the review bot, nothing ever executed it against real code — only
CodeRabbit did, once per PR, as a comment. CI validated that the rules matched
their fixtures and stopped there.

The rules are a linter, so they run as an ordinary gate (`make lint-rules`,
plus a blocking CI job). CodeRabbit still loads them via
`reviews.tools.ast-grep.rule_dirs` — it is one consumer of the ruleset, not its
owner. See `dev/lint/ast-grep/README.md`.

## What belongs in CodeRabbit, and what does not

The division that keeps review comments worth reading:

| Kind of rule                             | Home                                       |
| ---------------------------------------- | ------------------------------------------ |
| Expressible as oxlint config             | `/.oxlintrc.architecture.json`             |
| Expressible as a syntactic pattern       | `/dev/lint/ast-grep/rules/`                |
| Expressible as a semantic pattern        | `/dev/lint/semgrep/langwatch.yml`          |
| Genuinely needs judgement                | `path_instructions` in `/.coderabbit.yaml` |

**There is one general-purpose JavaScript and TypeScript linter, and it is
oxlint.** `/.oxlintrc.architecture.json` covers `packages/**` and `apps/**` in
two rule blocks, because the two rulesets arrived from two tools with different
baselines rather than because they deserve different rules; converging them is
follow-up work. Every rule in it is `error`. Formatting is oxfmt's, configured
in `/.oxfmtrc.json`.

A rule in more than one home gets reported twice — once deterministically and
once probabilistically — which is how a review thread fills up with mechanics
and trains people to skim it. **When a rule moves into a linter, delete it from
`path_instructions`.**

Across a 50-PR sample of contributor PRs, 23% of CodeRabbit's findings were
deterministic house rules it had been handed via `path_instructions` and
`knowledge_base.code_guidelines`. Those belong in the three rows above this one.

## Related

- `dev/lint/ast-grep/` — the syntactic ruleset (and its fixtures).
- `/dev/lint/semgrep/langwatch.yml` — semantic patterns (PII regex, ClickHouse
  TenantId enforcement, heavy-column dedup anti-pattern).
- `/.github/workflows/coderabbit-config-check.yml` — proves the rulesets parse
  and still match their fixtures (pinned ast-grep + `semgrep --validate`).
- `/.github/workflows/deployment-impact-check.yml` — AC5 deployment-surface
  guard (moved out of CodeRabbit because `path_instructions` can't see PR
  descriptions).
- `dev/docs/best_practices/`, `dev/docs/design/`, `dev/docs/adr/` — house
  style sources, included in `knowledge_base.code_guidelines.filePatterns`
  so CR can cite them in review comments.
