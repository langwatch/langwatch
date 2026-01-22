# Skills

Specialized workflows and automation for common tasks.

## Available Skills

### Orchestration

- **orchestrator** (background) - Auto-activates on implementation requests. Manages the implement → verify → review loop.
- **implement** - Manual trigger: `/implement #123` or `/implement <feature-description>`. Entry point for GitHub issues and feature requests.

## How Skills Work

Skills are markdown files with YAML frontmatter that define:
- **name** - Skill identifier
- **description** - When to activate (for background skills) or usage info (for user-invocable)
- **user-invocable** - Whether users can trigger with `/skillname`
- **disable-model-invocation** - Prevent automatic activation
- **allowed-tools** - Tool restrictions
- **argument-hint** - Help text for arguments

## Related

- `.claude/agents/` - Sub-agents spawned by skills (coder, uncle-bob-reviewer)
- `specs/features/` - BDD feature files used as requirements source
