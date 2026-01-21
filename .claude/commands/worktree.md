# Worktree

Create a git worktree for branch `$ARGUMENTS`.

## Important

Worktrees go in `/Users/hope/workspace/langwatch/worktree-$ARGUMENTS`, not inside langwatch-saas.

## Steps

1. `git fetch origin`
2. Check if branch exists: `git branch -r | grep -qw "origin/$ARGUMENTS"`
3. Create worktree:
   - Existing branch: `git worktree add "/Users/hope/workspace/langwatch/worktree-$ARGUMENTS" "$ARGUMENTS"`
   - New branch: `git worktree add -b "$ARGUMENTS" "/Users/hope/workspace/langwatch/worktree-$ARGUMENTS" main`
4. Copy .env: `cp langwatch/.env "/Users/hope/workspace/langwatch/worktree-$ARGUMENTS/langwatch/.env"`
5. Report path to user
