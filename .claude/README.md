# Claude Code Orchestration System

For the full orchestration workflow, agent list, and command reference, see `AGENTS.md` in the repo root.

For detailed orchestration steps (bug-fix and feature workflows), see `.claude/skills/orchestrate/SKILL.md`.

## Directory Structure

```
.claude/
├── agents/         # Agent definitions (personas with workflows)
├── skills/         # Skills (entry points that invoke agents)
└── commands/       # Slash commands (non-agent utilities)
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `/orchestrate <req>` | Enter orchestration mode with requirements |
| `/implement #123` | Fetch issue → invoke `/orchestrate` |
| `/plan <feature>` | Create feature file |
| `/code <task>` | Implement with TDD |
| `/review <focus>` | Quality review (parallel: uncle-bob + cupid + test-reviewer) |
| `/challenge <proposal>` | Stress-test proposals and plans |
| `/browser-test [port] [feature]` | Verify feature in real browser |
| `/sherpa <question>` | Docs/DX/meta-layer |
