# Commands

Simple slash commands that provide instructions to Claude without spawning agents or forking context.

## Commands vs Skills

| Aspect | Commands | Skills |
|--------|----------|--------|
| Location | `.claude/commands/` | `.claude/skills/` |
| Invocation | `/command` | `/skill` |
| Context | Same thread | Can fork (`context: fork`) |
| Agents | Reference by name | Invoke via `agent:` frontmatter |
| Complexity | 1-5 lines, simple instructions | Workflows, may spawn agents |

**Rule of thumb**: If it just tells Claude what to do, it's a command. If it spawns an agent or runs a multi-step workflow, it's a skill.

## Available Commands

| Command | Purpose |
|---------|---------|
| `/onboard` | Orientation via sherpa + code review |
| `/pr-review` | Address PR comments from Code Rabbit/reviewers |
| `/worktree` | Create git worktree with proper setup |
| `/review` | Invoke uncle-bob-reviewer (legacy, prefer skill) |
| `/sherpa` | Invoke repo-sherpa (legacy, prefer skill) |

Note: `/review` and `/sherpa` commands exist for backward compatibility. The skills (`skills/review/`, `skills/sherpa/`) are preferred as they use `context: fork` for proper isolation.

## Writing Commands

Commands should be 1-5 lines of instructions. If a command invokes an agent, reference it by name - the agent has its own instructions.

## Related

- `.claude/skills/` - For workflows that spawn agents
- `.claude/agents/` - Agent definitions
