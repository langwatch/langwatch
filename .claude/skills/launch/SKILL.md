---
name: launch
description: Create worktrees, tmux sessions, and Claude sessions for GitHub issues. Use when spinning up parallel implementation work.
argument-hint: "#1766 #1768 #1769"
user-invocable: true
---

# Launch

Spin up parallel worktrees with tmux + Claude sessions for one or more GitHub issues.

## Arguments

`$ARGUMENTS` is a space-separated list of issue numbers (with or without `#`). Example: `/launch #1766 #1768 1769`

## Steps

### 1. Parse issue numbers

Extract all numeric issue IDs from `$ARGUMENTS`. Strip `#` prefixes.

### 2. For each issue, create a worktree

Use the repo's `scripts/worktree.sh` logic (but don't exec into a shell):

1. `git fetch origin`
2. Fetch issue title: `gh issue view <N> --repo langwatch/langwatch --json title --jq '.title'`
3. Generate slug: lowercase, replace non-alphanumeric with hyphens, collapse, trim, max 50 chars at word boundary
4. Branch: `issue<N>/<slug>`
5. Directory: `.worktrees/issue<N>-<slug>`
6. Skip if directory already exists (report it, don't error)
7. Create worktree:
   - If branch exists on remote: `git worktree add "$DIR" "$BRANCH"`
   - Otherwise: `git worktree add -b "$BRANCH" "$DIR" origin/main`
8. Copy `.env*` files from `.`, `langwatch/`, and `langwatch_nlp/` into the worktree

### 3. Create tmux sessions

For each worktree:
- Session name = directory basename (e.g., `issue1766-multi-select-scenarios-should-show-hover-menu`)
- `tmux new-session -d -s "$SESSION" -c "$WORKTREE_PATH"`
- Skip if session already exists

### 4. Launch Claude in each session

For each session, use this exact sequence (the sleep + double-Enter pattern is critical — Claude's TUI swallows the first Enter during startup):

```bash
# Start Claude
tmux send-keys -t "$SESSION" "claude --dangerously-skip-permissions" Enter

# Wait for Claude to fully load
sleep 10

# Send the command text WITHOUT Enter
tmux send-keys -t "$SESSION" "/implement #<N>"
sleep 1

# Send Enter separately — twice, because the first may be swallowed
tmux send-keys -t "$SESSION" Enter
sleep 1
tmux send-keys -t "$SESSION" Enter
```

**Do NOT** combine the message and Enter in one `send-keys` call (e.g., `send-keys "text" Enter`). Send them separately with sleeps.

### 5. Report summary

Print a table of all sessions created:

```
| Session | Branch | Issue |
|---------|--------|-------|
| <session-name> | <branch> | <issue-title> |
```

And remind the user they can:
- `tmux attach -t <session>` to check on a session
- `orchard` to see all worktrees in the TUI
