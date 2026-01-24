# Git Worktrees

Git worktrees allow you to work on multiple branches simultaneously in separate directories.

## Setup

### Location

Worktrees should be created as siblings of `langwatch-saas`, NOT inside it.

```
<workspace>/
├── langwatch-saas/              # Main repo
│   └── langwatch/langwatch/     # Submodule (this repo)
└── worktree-<branch-name>/      # Worktrees go here (sibling of langwatch-saas)
    └── langwatch/
```

### Creating a Worktree

1. Navigate to the langwatch submodule:
   ```bash
   cd langwatch-saas/langwatch/langwatch
   ```

2. Ensure you're on main and it's up to date:
   ```bash
   git checkout main && git pull
   ```

3. Create the worktree (paths relative to langwatch-saas parent):
   ```bash
   # For an existing branch:
   git worktree add "../../worktree-<branch-name>" "<branch-name>"

   # For a new branch:
   git worktree add -b "<branch-name>" "../../worktree-<branch-name>" main
   ```

4. Copy the `.env` file:
   ```bash
   cp .env "../../worktree-<branch-name>/langwatch/.env"
   ```

5. Install dependencies in the new worktree:
   ```bash
   cd "../../worktree-<branch-name>/langwatch"
   pnpm install
   ```

### Listing Worktrees

```bash
git worktree list
```

### Removing a Worktree

```bash
git worktree remove "../../worktree-<branch-name>"
```

## Important Notes

- Always copy `.env` to the new worktree - it's gitignored and won't be created automatically
- Run `pnpm install` in each new worktree
- Worktrees share the same git history but have independent working directories
