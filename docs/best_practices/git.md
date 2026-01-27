# Git & GitHub

- [Conventional Commits](https://www.conventionalcommits.org/)
- Link PRs to issues with `Closes #N`

## Branch Naming

| Branch Type | Format | Example |
|-------------|--------|---------|
| Issue-linked | `issue<number>/<slug>` | `issue123/user-login-feature` |
| Feature | `feat/<slug>` | `feat/dark-mode` |
| Bugfix | `fix/<slug>` | `fix/auth-redirect` |
| Refactor | `refactor/<slug>` | `refactor/api-cleanup` |

**Rules:**
- Slugs: lowercase, hyphen-separated, max 40 characters
- Issue-linked branches: always use `issue<number>/` prefix (no hyphen after "issue")
- The issue number prefix enables easy lookup: `git branch | grep issue123`

## Worktrees

Worktree directories use the pattern: `worktree-<branch-slug>`

| Branch | Directory |
|--------|-----------|
| `issue123/user-login` | `worktree-issue123-user-login` |
| `feat/dark-mode` | `worktree-feat-dark-mode` |

Create worktrees with `/worktree`:
```bash
/worktree #123          # Creates issue123/<slug> from issue title
/worktree my-feature    # Creates feat/my-feature
```

See `.claude/commands/worktree.md` for full details.

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
