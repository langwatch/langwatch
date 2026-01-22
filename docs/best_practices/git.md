# Git & GitHub

- [Conventional Commits](https://www.conventionalcommits.org/)
- Link PRs to issues with `Closes #N`

## Issues

When creating issues, add them to the **LangWatch Kanban** project and fill in:
- **Project** - category (e.g., "📖 Documentation", "🎭 Agent Simulations")
- **Priority** - P0/P1/P2/P3
- **Size** - XS/S/M/L/XL
- **Epic** - if applicable
- **Labels** and **Milestone** when relevant

```bash
# Create issue and add to project
gh issue create --repo langwatch/langwatch --title "..." --body "..."
gh project item-add 5 --owner langwatch --url <issue-url>
# Then set fields in the GitHub Projects UI
```
