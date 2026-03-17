# LangWatch Skills

Customer-facing Agent Skills following the [agentskills.io](https://agentskills.io) open standard. Each skill teaches AI coding agents (Claude Code, Cursor, Codex, etc.) how to perform LangWatch workflows autonomously.

## Available Skills

| Skill | Purpose |
|-------|---------|
| `create-agent` | Scaffold a complete AI agent project from scratch with LangWatch instrumentation, prompt versioning, evaluation experiments, and scenario tests |

## Installation

### Via skills CLI
```bash
npx skills add langwatch/langwatch --skill create-agent
```

### Via compiled prompt (copy-paste)
Pre-generated prompts are available in `_compiled/`:
- `create-agent.platform.txt` — for use on LangWatch onboarding pages (API key placeholder)
- `create-agent.docs.txt` — for use in documentation (asks user for API key)

### Manual
Copy `skills/create-agent/SKILL.md` and its `references/` directory into your project.

## Structure

```
skills/
├── create-agent/           # Skill: scaffold agent projects from scratch
│   ├── SKILL.md            # Main skill file (<500 lines)
│   └── references/         # Framework-specific guides (loaded on demand)
├── _shared/                # Shared references used by all skills
│   ├── mcp-setup.md        # MCP server installation
│   ├── api-key-setup.md    # API key configuration
│   ├── llms-txt-fallback.md # Fallback when MCP unavailable
│   └── guard-rails.md      # Known agent failure modes
├── _compiler/              # Prompt compiler (SKILL.md → copy-paste prompts)
├── _compiled/              # Pre-generated prompts (do not edit manually)
└── _tests/                 # Scenario tests proving skills work
```

## Adding a New Skill

1. Create a directory: `skills/<skill-name>/`
2. Add a `SKILL.md` with agentskills.io frontmatter (`name`, `description`, `license`, `compatibility`)
3. Keep body under 500 lines — use `references/` for extended content
4. Run `bash skills/_compiled/generate.sh` to compile prompts
5. Add scenario tests in `skills/_tests/`

## Developing

```bash
# Run compiler unit tests
npx vitest run --config skills/_tests/vitest.config.ts skills/_compiler/__tests__/

# Run scenario tests (requires Claude Code signed in, skips in CI)
cd skills/_tests && pnpm test

# Regenerate compiled prompts
bash skills/_compiled/generate.sh
```
