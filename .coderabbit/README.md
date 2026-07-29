# `.coderabbit/`

CodeRabbit configuration ancillary files. The root config is `/.coderabbit.yaml`.

## The ast-grep ruleset moved to `/.ast-grep/`

It used to live here as `ast-grep/`. That framing was the problem: filed under
the review bot, nothing ever executed it against real code — only CodeRabbit
did, once per PR, as a comment. CI validated that the rules matched their
fixtures and stopped there.

The rules are a linter, so they now sit at `/.ast-grep/`, next to `/.semgrep/`,
and run as an ordinary gate (`make lint-rules`, plus a blocking CI job).
CodeRabbit still loads them via `reviews.tools.ast-grep.rule_dirs` — it is one
consumer of the ruleset, not its owner. See `/.ast-grep/README.md`.

## What belongs in CodeRabbit, and what does not

The division that keeps review comments worth reading:

| Kind of rule | Home |
|---|---|
| Expressible as Biome config | `platform/app/biome.json` |
| Expressible as a syntactic pattern | `/.ast-grep/rules/` |
| Expressible as a semantic pattern | `/.semgrep/langwatch.yml` |
| Genuinely needs judgement | `path_instructions` in `/.coderabbit.yaml` |

A rule in more than one home gets reported twice — once deterministically and
once probabilistically — which is how a review thread fills up with mechanics
and trains people to skim it. **When a rule moves into a linter, delete it from
`path_instructions`.**

Across a 50-PR sample of contributor PRs, 23% of CodeRabbit's findings were
deterministic house rules it had been handed via `path_instructions` and
`knowledge_base.code_guidelines`. Those belong in the three rows above this one.

## Related

- `/.ast-grep/` — the syntactic ruleset (and its fixtures).
- `/.semgrep/langwatch.yml` — semantic patterns (PII regex, ClickHouse
  TenantId enforcement, heavy-column dedup anti-pattern).
- `/.github/workflows/coderabbit-config-check.yml` — proves the rulesets parse
  and still match their fixtures (pinned ast-grep + `semgrep --validate`).
- `/.github/workflows/deployment-impact-check.yml` — AC5 deployment-surface
  guard (moved out of CodeRabbit because `path_instructions` can't see PR
  descriptions).
- `dev/docs/best_practices/`, `dev/docs/design/`, `dev/docs/adr/` — house
  style sources, included in `knowledge_base.code_guidelines.filePatterns`
  so CR can cite them in review comments.
