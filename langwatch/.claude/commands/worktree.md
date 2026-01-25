# Worktree

Create a git worktree for branch `$ARGUMENTS`.

See `src/docs/WORKTREES.md` for full documentation.

## Quick Steps

1. Checkout main: `git checkout main && git pull`
2. Create worktree:
   - Existing branch: `git worktree add "../../worktree-$ARGUMENTS" "$ARGUMENTS"`
   - New branch: `git worktree add -b "$ARGUMENTS" "../../worktree-$ARGUMENTS" main`
3. Copy .env: `cp .env "../../worktree-$ARGUMENTS/langwatch/.env"`
4. Install deps: `cd "../../worktree-$ARGUMENTS/langwatch" && pnpm install`
