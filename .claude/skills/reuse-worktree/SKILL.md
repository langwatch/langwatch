---
name: reuse-worktree
description: "Reset this worktree to latest main and create a new branch for fresh work."
user-invocable: true
argument-hint: "<branch-name>"
---

Reset this worktree to latest main and create a new branch for fresh work.

Steps:
1. `git fetch origin main`
2. `git reset --hard origin/main`
3. Create a new branch: `git checkout -b $ARGUMENTS`

If no branch name is provided, ask the user what to name the branch.
