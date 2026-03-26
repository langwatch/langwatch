# Agents

Specialized Claude personas with defined workflows. Agents run in isolated context forks and return structured summaries.

## Available Agents

| Agent | Purpose | Invoked via |
|-------|---------|-------------|
| `coder` | TDD implementation, self-verification | `/code` skill |
| `repo-sherpa` | Documentation, DX, meta-layer ownership | `/sherpa` skill |
| `uncle-bob-reviewer` | SOLID/Clean Code review | `/review` skill |
| `devils-advocate` | Stress-test proposals, plans, and architecture decisions | `/challenge` skill |
| `playwright-test-planner` | Creates test plans by exploring the live app | Ad-hoc (via Task) |
| `playwright-test-generator` | Generates Playwright tests from plans | Ad-hoc (via Task) |
| `playwright-test-healer` | Debugs and fixes failing tests | Ad-hoc (via Task) |
| `test-reviewer` | Reviews tests for quality, pyramid placement, and maintainability | `/review` skill |

## How Agents Are Invoked

Agents are invoked **only through skills**, never directly. Skills use `context: fork` + `agent: <name>` frontmatter:

```yaml
---
name: code
context: fork        # Creates isolated context
agent: coder         # Agent to invoke
user-invocable: true
---
```

This pattern ensures agents run in isolation and return summaries to the main thread.

## Writing Agents

Keep prompts minimal. Agents inherit Claude's knowledge of standard practices (SOLID, Clean Code, TDD). Only document:

- Project-specific context and conventions
- File references (`dev/docs/TESTING_PHILOSOPHY.md`, `dev/docs/best_practices/`)
- Behavioral overrides (tone, output format)

Do not explain standard concepts - agents already know them.

## Related

- `.claude/skills/` - Skills that invoke agents (`code`, `review`, `sherpa`, `challenge`, `browser-test`)
- `.claude/README.md` - Full orchestration system documentation
- `dev/docs/adr/010-e2e-testing-strategy.md` - Why browser verification replaced E2E test generation
