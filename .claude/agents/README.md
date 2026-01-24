# Agents

Specialized Claude personas with defined workflows. Agents run in isolated context forks and return structured summaries.

## Available Agents

| Agent | Purpose | Invoked via |
|-------|---------|-------------|
| `coder` | TDD implementation, self-verification | `/code` skill |
| `repo-sherpa` | Documentation, DX, meta-layer ownership | `/sherpa` skill |
| `uncle-bob-reviewer` | SOLID/Clean Code review | `/review` skill |
| `playwright-test-planner` | Creates test plans by exploring the live app | `/e2e` skill (via Task) |
| `playwright-test-generator` | Generates Playwright tests from plans | `/e2e` skill (via Task) |
| `playwright-test-healer` | Debugs and fixes failing tests | `/e2e` skill (via Task) |
| `test-reviewer` | Reviews tests for quality, pyramid placement, and maintainability | `/e2e` skill (via Task) |

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
- File references (`docs/TESTING_PHILOSOPHY.md`, `docs/best_practices/`)
- Behavioral overrides (tone, output format)

Do not explain standard concepts - agents already know them.

## Related

- `.claude/skills/` - Skills that invoke agents (`code`, `review`, `sherpa`, `e2e`)
- `.claude/README.md` - Full orchestration system documentation
- `agentic-e2e-tests/README.md` - E2E test conventions and setup
