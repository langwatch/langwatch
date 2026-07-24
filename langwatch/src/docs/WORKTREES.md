# Git Worktrees

Git worktrees allow you to work on multiple branches simultaneously in separate directories.

## Quick Start

Use the `make worktree` command from the repo root:

```bash
# From an issue number (fetches title from GitHub, derives branch name):
make worktree 1663

# From a feature name:
make worktree add-dark-mode
```

Or call the script directly:

```bash
./scripts/worktree.sh 1663           # issue-based
./scripts/worktree.sh add-dark-mode  # feature-based
```

The script will:
1. Fetch latest from `origin`
2. Derive a branch name (`issue<N>/<slug>` or `feat/<name>`)
3. Create the worktree in `.worktrees/<branch-with-slash-as-hyphen>/`
4. Check out an existing remote branch if one exists, or create a new branch from `origin/main`
5. Copy all `.env*` files from the current directory
6. Run `pnpm install` in the new worktree
7. Print a summary with the `cd` command to start working

## Directory Layout

Worktrees are created inside the `.worktrees/` directory at the repo root:

```
langwatch/                                    # Repo root
├── .worktrees/                               # All worktrees (gitignored)
│   ├── issue1663-fix-scenario-runs/          # Issue-based worktree
│   └── feat-add-dark-mode/                   # Feature-based worktree
├── scripts/worktree.sh                       # Worktree creation script
└── ...
```

## Branch Naming Convention

| Input | Branch Name | Directory |
|-------|-------------|-----------|
| `1663` (issue) | `issue1663/<slug-from-title>` | `.worktrees/issue1663-<slug>` |
| `add-dark-mode` | `feat/add-dark-mode` | `.worktrees/feat-add-dark-mode` |

Slugs are derived from issue titles: lowercase, hyphens, special characters stripped, truncated at word boundary for very long titles.

## Managing Worktrees

### Listing Worktrees

```bash
git worktree list
```

### Removing a Worktree

```bash
git worktree remove .worktrees/<directory-name>
```

## Important Notes

- The script copies all `.env*` files and runs `pnpm install` automatically
- Worktrees share the same git history but have independent working directories
- The `.worktrees/` directory is gitignored
- The `gh` CLI is required for issue-based worktrees (to fetch the issue title)
