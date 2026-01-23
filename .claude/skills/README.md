# Skills

Entry points that invoke agents or orchestrate workflows. Skills can fork context and spawn specialized agents.

## Available Skills

### Agent Delegation Skills

These skills use `context: fork` to spawn agents in isolated contexts:

| Skill | Agent | Purpose |
|-------|-------|---------|
| `/plan` | Plan (built-in) | Create feature file with acceptance criteria |
| `/code` | coder | Implement with TDD, self-verification |
| `/review` | uncle-bob-reviewer | SOLID/Clean Code review |
| `/sherpa` | repo-sherpa | Documentation, DX, meta-layer |

### Orchestration Skills (Opt-In)

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `/orchestrate` | Manual (`/orchestrate <requirements>`) | Manages plan/code/review loop |
| `/implement` | Manual (`/implement #123`) | Entry point for GitHub issues (invokes `/orchestrate`) |

## The context:fork + agent Pattern

Skills bridge user commands to agents:

```yaml
---
name: code
context: fork        # Creates isolated context
agent: coder         # Agent to invoke
user-invocable: true
argument-hint: "[requirements or feature-file-path]"
---

Implement the following:
$ARGUMENTS
```

Flow:
```
/code "implement login"
    |
    v
skills/code/SKILL.md
    | context: fork
    | agent: coder
    v
agents/coder.md (runs in fork)
    |
    v
Returns summary to main thread
```

## Skill Frontmatter Properties

| Property | Description |
|----------|-------------|
| `name` | Skill identifier |
| `description` | When to activate (background) or usage info |
| `context: fork` | Creates isolated context for agent |
| `agent` | Agent to invoke (from `.claude/agents/`) |
| `user-invocable` | Can be triggered with `/skillname` |
| `disable-model-invocation` | Prevent automatic activation |
| `argument-hint` | Help text for arguments |

## Related

- `.claude/agents/` - Agent definitions invoked by skills
- `.claude/commands/` - Simple commands (no agents, no forks)
- `.claude/README.md` - Full orchestration system documentation
- `specs/features/` - BDD feature files used as requirements source
