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

Worktrees live in the `.worktrees/` directory at the repo root (gitignored).

| Branch | Directory |
|--------|-----------|
| `issue123/user-login` | `.worktrees/issue123-user-login` |
| `feat/dark-mode` | `.worktrees/feat-dark-mode` |

Create worktrees with `make worktree` or the script directly:
```bash
make worktree 123           # Creates issue123/<slug> from issue title
make worktree my-feature    # Creates feat/my-feature

# Or directly:
./scripts/worktree.sh 123
./scripts/worktree.sh my-feature
```

The script fetches from origin, derives branch/directory names, creates the worktree, copies `.env*` files, and prints a summary with next steps.

See `langwatch/src/docs/WORKTREES.md` for full details.

## Issues

When creating issues, add them to the **LangWatch Kanban** project and fill in:
- **Project** - category (e.g., "📖 Documentation", "🎭 Agent Simulations")
- **Priority** - P0/P1/P2/P3
- **Size** - XS/S/M/L/XL
- **Epic** - if applicable
- **Labels** and **Milestone** when relevant
