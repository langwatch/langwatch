---
allowed-tools: Bash(gh:*), Bash(git:*), Read, Edit, Grep, Glob
description: Review and address unresolved PR comments from Code Rabbit and reviewers
argument-hint: [pr-number]
---

# Review and Address PR Comments

Review all unresolved comments on the current PR and help address them systematically.

## Step 1: Get PR Information

If no PR number provided ($ARGUMENTS is empty), detect from current branch:

```bash
# Get current branch
BRANCH=$(git branch --show-current)

# Find PR for this branch
gh pr list --head "$BRANCH" --json number,title,url --jq '.[0]'
```

If PR number provided, use that: `$ARGUMENTS`

## Step 2: Fetch All Unresolved Comments

Get all review comments and PR comments. First, extract repo info and set PR_NUMBER:

```bash
# Extract owner/repo from git remote (assumes origin)
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')

# Set PR_NUMBER from arguments or detected PR
PR_NUMBER="${ARGUMENTS:-$(gh pr list --head "$(git branch --show-current)" --json number --jq '.[0].number')}"
```

Then fetch comments:

```bash
# Get PR review comments (code comments)
gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments" --jq '.[] | select(.in_reply_to_id == null) | {id: .id, path: .path, line: .line, body: .body, user: .user.login, url: .html_url}'

# Get PR conversation comments
gh api "repos/$OWNER/$REPO/issues/$PR_NUMBER/comments" --jq '.[] | {id: .id, body: .body, user: .user.login, url: .html_url}'

# Get pending review threads (unresolved)
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 10) {
              nodes {
                body
                author { login }
                path
                line
              }
            }
          }
        }
      }
    }
  }
' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR_NUMBER"
```

## Step 3: Triage Comments

For each unresolved comment, categorize into:

### Should Address
- Security concerns
- Bug fixes
- Logic errors
- Missing error handling
- Breaking changes

### Can Safely Ignore (with justification)
- Style preferences that don't match project conventions
- Suggestions already addressed
- False positives from automated tools
- Nitpicks on working code
- Outdated comments (code already changed)

Present a clear report to the user:

```
## Comments to Address

1. **[path/to/file.ts:42]** (Code Rabbit)
   > Comment text here

   **Why address:** Brief reasoning
   **Suggested fix:** What to change

2. ...

## Comments to Ignore

1. **[path/to/file.ts:15]** (Code Rabbit)
   > Comment text here

   **Why ignore:** Brief reasoning (e.g., "Style preference - project uses different convention")

```

## Step 4: Implement Fixes

For each comment marked "to address":
1. Read the relevant file
2. Understand the context
3. Implement the fix
4. Show the user what was changed

## Step 5: Resolve Comments

After addressing comments, resolve them via GitHub API:

```bash
# For GraphQL-based resolution (review threads)
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread { isResolved }
    }
  }
' -f threadId=$THREAD_ID
```

## Step 6: Check Rebase Status

Check if the branch needs rebasing:

```bash
# Fetch latest
git fetch origin main

# Check if behind
git rev-list --count HEAD..origin/main
```

If behind, offer to rebase:
```bash
git rebase origin/main
```

## Output Summary

After completing, provide:
1. Summary of comments addressed
2. Summary of comments ignored (with reasons)
3. List of files modified
4. Rebase status
5. Next steps (push, request re-review, etc.)
