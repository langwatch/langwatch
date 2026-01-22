# Claude Code Configuration

## Structure

```
.claude/
├── agents/     # Sub-agents (repo-sherpa, uncle-bob-reviewer)
├── commands/   # Slash commands (/review, /sherpa, /pr-review, etc.)
└── README.md   # This file
```

See `agents/README.md` and `commands/README.md` for details.

## Token-Conscious Principle

Agents know standard practices (SOLID, Clean Code, TDD). Only document:
- Project-specific context
- File references
- Behavioral overrides
