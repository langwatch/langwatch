---
allowed-tools: Bash(git:*), Bash(cp:*), Bash(ls:*), Bash(mkdir:*), Read
description: Create a git worktree with proper setup for local development
argument-hint: <branch-name>
---

# Create Git Worktree

Create a properly configured git worktree for the branch: `$ARGUMENTS`

## Important: Worktree Location

Worktrees should be created in the **workspace root** (parent of `langwatch-saas`), NOT inside `langwatch-saas/`. This is because `langwatch-saas` is a git repo itself.

## Steps

1. **Determine the worktree path:**
   - Worktree name: `worktree-$ARGUMENTS`
   - Full path: `../worktree-$ARGUMENTS` (relative to langwatch-saas)

2. **Check if branch exists remotely:**
   ```bash
   git fetch origin
   # Use exact match with word boundaries to avoid partial matches
   if git branch -r | grep -qw "origin/$ARGUMENTS"; then
     echo "Branch exists remotely"
   else
     echo "Branch does not exist, will create new branch"
   fi
   ```

3. **Create the worktree:**
   - If branch exists: `git worktree add "../worktree-$ARGUMENTS" "$ARGUMENTS"`
   - If new branch: `git worktree add -b "$ARGUMENTS" "../worktree-$ARGUMENTS" main`

4. **Copy the .env file for local testing:**
   ```bash
   if [ -f langwatch/.env ]; then
     cp langwatch/.env "../worktree-$ARGUMENTS/langwatch/.env" || echo "Warning: Failed to copy .env file"
   else
     echo "Warning: langwatch/.env not found, skipping copy"
   fi
   ```

5. **Verify setup:**
   - Confirm worktree exists
   - Confirm .env was copied
   - Show the path to the user

## Output

After completing, tell the user:
- The full path to the worktree
- That the .env file has been copied
- How to cd into it

## Cleanup Reminder

To remove a worktree later:
```bash
git worktree remove "../worktree-$ARGUMENTS"
```
