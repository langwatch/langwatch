# Agents

Specialized Claude personas with defined workflows. Agents run in isolated context forks and return structured summaries.

## Available Agents

| Agent | Purpose | Invoked via |
|-------|---------|-------------|
| `coder` | TDD implementation, self-verification | `/code` skill |
| `repo-sherpa` | Documentation, DX, meta-layer ownership | `/sherpa` skill |
| `uncle-bob-reviewer` | SOLID/Clean Code review | `/review` skill |

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

- `.claude/skills/` - Skills that invoke agents (`code`, `review`, `sherpa`)
- `.claude/README.md` - Full orchestration system documentation
