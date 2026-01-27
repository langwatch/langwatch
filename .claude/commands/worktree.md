# Worktree

Create a git worktree for a branch. Worktrees go in `/Users/hope/workspace/langwatch/`, not inside langwatch-saas.

## Naming Standards

| Input Type | Branch Name | Directory Name |
|------------|-------------|----------------|
| Issue number (`#123` or `123`) | `issue123/<slug>` | `worktree-issue123-<slug>` |
| Existing branch (`feat/foo`) | `feat/foo` (unchanged) | `worktree-feat-foo` |
| New feature (`my-feature`) | `feat/my-feature` | `worktree-feat-my-feature` |

**Slug derivation for issues:**
- Fetch issue title from GitHub
- Convert to lowercase, replace spaces/special chars with hyphens
- Truncate to 40 chars max

## Steps

### For Issue Numbers (`/worktree #123` or `/worktree 123`)

1. `git fetch origin`
2. Fetch issue: `gh issue view <number> --json title,number`
3. Derive slug from title (lowercase, hyphens, max 40 chars)
4. Set branch name: `issue<number>/<slug>` (e.g., `issue123/user-login-feature`)
5. Set directory: `/Users/hope/workspace/langwatch/worktree-issue<number>-<slug>`
6. Check if branch exists: `git branch -r | grep -qw "origin/$BRANCH"`
7. Create worktree:
   - Existing: `git worktree add "$DIR" "$BRANCH"`
   - New: `git worktree add -b "$BRANCH" "$DIR" origin/main`
8. Copy .env: `cp langwatch/.env "$DIR/langwatch/.env"`
9. Report: branch name, directory path, and linked issue

### For Existing Branches (`/worktree feat/existing-branch`)

1. `git fetch origin`
2. Verify branch exists: `git branch -r | grep -qw "origin/$ARGUMENTS"`
3. Derive directory from branch (replace `/` with `-`): `worktree-feat-existing-branch`
4. Create worktree: `git worktree add "$DIR" "$ARGUMENTS"`
5. Copy .env: `cp langwatch/.env "$DIR/langwatch/.env"`
6. Report path to user

### For New Feature Names (`/worktree my-new-feature`)

1. `git fetch origin`
2. Confirm branch doesn't exist
3. Set branch name: `feat/$ARGUMENTS`
4. Set directory: `/Users/hope/workspace/langwatch/worktree-feat-$ARGUMENTS`
5. Create worktree: `git worktree add -b "$BRANCH" "$DIR" origin/main`
6. Copy .env: `cp langwatch/.env "$DIR/langwatch/.env"`
7. Report path to user

## Examples

```bash
/worktree #1234                    # → issue1234/http-agent-support in worktree-issue1234-http-agent-support
/worktree issue1234/existing       # → Uses existing branch in worktree-issue1234-existing
/worktree add-dark-mode            # → feat/add-dark-mode in worktree-feat-add-dark-mode
```
