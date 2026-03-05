---
name: watch-ci
description: "Watch CI for the current branch's PR. Blocks until CI completes, then fixes failures or addresses review comments. Loops until green."
user-invocable: true
argument-hint: "[--once]"
---

# Watch CI

Monitor the current branch's PR for CI failures and review comments. Fix issues automatically and loop until clean.

## Flow

```
┌─► gh pr checks --watch (blocks, zero tokens)
│         │
│    pass ▼ fail
│    ┌────┴────┐
│    │         │
│    │    Read logs, diagnose, fix, push
│    │         │
│    └────┬────┘
│         │
│    Check for unaddressed review comments
│         │
│    none ▼ found
│    ┌────┴────┐
│    │         │
│    │    Address comments, push
│    │         │
│    └────┬────┘
│         │
│         ▼
│    CI still running? ──yes──► loop back
│         │
│        no, all green
│         ▼
│       Done ✓
└─────────────────────────────────
```

## Steps

### 1. Find the PR

```bash
gh pr view --json number,title,headRefName,url --jq '{number, title, headRefName, url}'
```

If no PR exists for the current branch, tell the user and exit.

### 2. Wait for CI

Run this and let it block — it costs zero tokens while waiting:

```bash
gh pr checks --watch --fail-fast 2>&1
```

This blocks until all checks complete. Capture the exit code and output.

### 3. Handle CI result

**If CI passes (exit 0):** proceed to step 4.

**If CI fails (exit non-zero):**

1. Get the failed check names from the output
2. Fetch the logs for each failed run:
   ```bash
   gh run view <run-id> --log-failed 2>&1 | tail -200
   ```
3. Diagnose the root cause from the logs
4. Fix the issue — edit files, run tests locally to verify
5. Commit and push:
   ```bash
   git add -A && git commit -m "fix: address CI failure - <brief description>"
   git push origin HEAD
   ```
6. Go back to step 2 (wait for CI again)

**Max 3 fix attempts.** If CI still fails after 3 pushes, report the situation to the user and stop.

### 4. Check for review comments

```bash
gh pr view --json reviewDecision,reviews,comments --jq '{
  reviewDecision,
  reviews: [.reviews[] | select(.state != "APPROVED" and .state != "DISMISSED") | {author: .author.login, state: .state, body: .body}],
  comments: [.comments[] | {author: .author.login, body: .body}]
}'
```

Also check inline review comments:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '[.[] | select(.position != null) | {path: .path, line: .line, body: .body, author: .user.login}]'
```

**If there are unaddressed review comments or changes requested:**

1. Read and understand each comment
2. Make the requested changes
3. Commit and push
4. Go back to step 2

**If review is clean or approved:** proceed to step 5.

### 5. Report

Print a summary:
- PR URL
- CI status (green)
- Review status
- What was fixed (if anything)

If `$ARGUMENTS` contains `--once`, stop here. Otherwise, ask the user if they want to keep watching.
