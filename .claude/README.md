# Claude Code Configuration

This directory contains configuration and custom commands for Claude Code.

## Directory Structure

```
.claude/
├── README.md           # This file - explains Claude Code configuration
├── CLAUDE.md           # Project memory and context (optional)
├── settings.json       # Project-wide settings (optional)
├── settings.local.json # Personal settings, gitignored (optional)
├── commands/           # Custom slash commands
│   ├── worktree.md     # /worktree - Create worktrees properly
│   └── pr-review.md    # /pr-review - Address PR comments
└── skills/             # Agent skills (auto-discovered by Claude)
    └── [skill-name]/
        └── SKILL.md
```

## How Claude Code Configuration Works

### Slash Commands (`/command`)

Slash commands are manually invoked prompts. Create them in `.claude/commands/`:

- **File**: `commands/my-command.md`
- **Invoke**: Type `/my-command` in Claude Code
- **Arguments**: Use `$ARGUMENTS` or `$1`, `$2` for positional args

**Example command file:**
```markdown
---
allowed-tools: Bash(git:*), Read
description: Short description shown in /help
argument-hint: [arg1] [arg2]
---

Your prompt here. Use $1 for first argument.
```

### Agent Skills (Auto-discovered)

Skills are complex capabilities Claude discovers and uses automatically based on context.

- **Location**: `.claude/skills/[skill-name]/SKILL.md`
- **Invocation**: Automatic based on description keywords
- **Structure**: Directory with SKILL.md and optional supporting files

**SKILL.md frontmatter:**
```yaml
---
name: skill-name
description: When to use this skill (keywords matter!)
allowed-tools: Read, Bash(npm:*)
---
```

### CLAUDE.md (Project Memory)

The `CLAUDE.md` file provides persistent context about the project. It can include:
- Project overview and architecture
- Coding standards and conventions
- Common commands (build, test, deploy)
- Important file locations

### settings.json

Configure permissions and behavior:

```json
{
  "permissions": {
    "allow": ["Bash(npm run:*)", "Bash(git:*)"],
    "deny": ["Read(.env*)"]
  }
}
```

## Available Commands

### `/worktree` - Create Git Worktrees

Creates worktrees in the correct location (workspace root, not inside langwatch-saas) and copies the `.env` file for local development.

**Usage:**
```
/worktree issue-1234
/worktree feature-name
```

**What it does:**
1. Creates worktree in the workspace root (not inside langwatch-saas)
2. Copies `.env` file from langwatch/ for local testing
3. Sets up the worktree for development

### `/pr-review` - Address PR Comments

Reviews and addresses unresolved PR comments from Code Rabbit and other reviewers.

**Usage:**
```
/pr-review
/pr-review 123  # Specific PR number
```

**What it does:**
1. Fetches all unresolved comments from the PR
2. Triages comments: what to address vs safely ignore (with reasoning)
3. Helps implement necessary fixes
4. Resolves comments via GitHub API
5. Checks if rebase is needed

## Personal vs Project Configuration

| Location | Scope | Git tracked? |
|----------|-------|--------------|
| `.claude/` | Project (team) | Yes |
| `.claude/settings.local.json` | Personal | No (gitignored) |
| `~/.claude/` | All projects | No |

## Best Practices

1. **Keep commands focused** - One clear purpose per command
2. **Use allowed-tools sparingly** - Only request what's needed
3. **Write clear descriptions** - They appear in `/help` output
4. **Test commands** - Run them before committing
5. **Document in this README** - Keep command list updated

## Resources

- [Claude Code Documentation](https://docs.anthropic.com/claude-code)
- [Claude Code Slash Commands](https://docs.anthropic.com/claude-code/slash-commands)
- [Claude Code Skills](https://docs.anthropic.com/claude-code/skills)
