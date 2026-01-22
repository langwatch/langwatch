# Agents

Specialized Claude sub-agents invoked via the Task tool.

## Available Agents

- **repo-sherpa** - Repository navigation, documentation maintenance
- **uncle-bob-reviewer** - Clean Code review (SOLID, TDD, best practices)

## Writing Agents

Keep prompts minimal. Agents inherit Claude's knowledge - only document:
- Project-specific context
- File references (`docs/TESTING_PHILOSOPHY.md`, `AGENTS.md`, `docs/best_practices/`)
- Behavioral overrides (tone, output format)

Don't explain standard concepts (SOLID, Clean Code) - agents already know them.
