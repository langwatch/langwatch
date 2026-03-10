---
name: drive-pr
description: "Drive a PR to mergeable state — fix CI failures and address review comments. Loops until green."
user-invocable: true
argument-hint: "[--once]"
---

# Drive PR

Drive the current branch's PR to mergeable state by fixing CI failures and addressing review comments. Loops until both are green.

## Flow

```
┌─► Wait for CI (or snapshot if --once)
│         │
│    pass ▼ fail
│    ┌────┴────┐
│    │         │
│    │    Read logs, diagnose, fix, push
│    │    (max 3 consecutive failures)
│    │         │
│    └────┬────┘
│         │
│    Check for unresolved review comments
│         │
│    none ▼ found
│    ┌────┴────┐
│    │         │
│    │    Triage, fix, reply, push
│    │         │
│    └────┬────┘
│         │
│    --once? ──yes──► Exit
│         │
│        no
│         ▼
└── Loop back to wait for CI
```

## Steps

### 1. Find the PR

```bash
gh pr view --json number,title,headRefName,url --jq '{number, title, headRefName, url}'
```

If no PR exists for the current branch, tell the user and exit.

### 2. Wait for CI

**Normal mode:** Run this and let it block — it costs zero tokens while waiting:

```bash
gh pr checks --watch --fail-fast 2>&1
```

**`--once` mode** (when `$ARGUMENTS` contains `--once`): Take a non-blocking snapshot instead:

```bash
gh pr checks --json name,state,bucket,link 2>&1
```

Parse the JSON output and inspect each check's `bucket` field:
- All checks have `bucket == "pass"` → proceed to step 4
- Any check has `bucket == "fail"` → handle as CI failure (step 3)
- Some checks have `bucket == "pending"` but none failed → proceed to step 4 (do not treat pending as failure)

Then proceed through steps 3-5 once and exit without looping.

### 3. Handle CI result

**Normal mode — If CI passes (exit 0):** proceed to step 4.

**Normal mode — If CI fails (exit non-zero):**

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

**Max 3 consecutive CI fix attempts.** If CI still fails after 3 pushes, report the situation to the user and stop. The counter resets whenever CI passes.

### 4. Check for review comments

Fetch the review decision:

```bash
gh pr view --json reviewDecision --jq '.reviewDecision'
```

Fetch unresolved review threads via GraphQL (REST does not expose thread resolution state):

```bash
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first: 100) {
          nodes {
            id
            path
            line
            isResolved
            isOutdated
            comments(first: 10) {
              nodes {
                body
                author { login }
              }
            }
          }
        }
      }
    }
  }
' -f owner='{owner}' -f repo='{repo}' -F pr={number}
```

Filter for threads where `isResolved == false` and `isOutdated == false` — these are the unresolved, current threads that need attention.

**If there are unresolved threads or `reviewDecision` is `CHANGES_REQUESTED`:** triage and address them (step 5), then push and loop back to step 2.

**If all threads are resolved and review is approved (or no review required):** proceed to step 6.

### 5. Triage and address review comments

Classify each comment into one of three categories:

**Fix now** = the code is broken or wrong:
- Security vulnerabilities
- Logic errors / bugs
- Missing error handling that causes crashes
- Incorrect behavior vs documented intent

**Out of scope (YAGNI)** = the code works but could do more:
- "Add support for X" when X isn't used yet
- "Handle edge case Y" when Y doesn't exist in production
- "Extend interface to include Z" when Z isn't stored/implemented
- Consistency improvements for features not yet built

**Won't fix** = not actionable:
- False positives from automated reviewers
- Style preferences that don't improve correctness

**Key question**: Is the reviewer pointing out something *broken*, or suggesting something *additional*? Only fix what's broken.

#### When to ask the user

**Always ask** when:
- A reviewer's comment is ambiguous (could be a bug or enhancement)
- Multiple valid approaches exist to fix an issue
- Removing/moving code that might be needed
- The fix would require significant architectural changes
- You're unsure if something is truly out of scope

#### Responding to comments

**Fix bugs in code we wrote.** If a reviewer points out broken behavior in code this PR introduces, fix it now.

**Don't add features that don't exist yet.** If a reviewer suggests "you should also handle X" but X isn't a current requirement, that's YAGNI. Respond with: "X isn't implemented/used yet. Will add when we build that feature."

**Never defer bugs to "future PR"** — that's avoiding work. But deferring unrequested features is correct.

When replying to threads:
- If fixed: briefly explain the fix
- If out of scope: explain what would need to exist first (DB schema, UI, etc.)
- If won't fix: provide technical reasoning

After addressing comments:
1. Commit and push changes
2. Reply to each thread explaining the resolution
3. Resolve addressed threads via `gh api graphql` mutation
4. Go back to step 2

### 6. Report

Print a summary:
- PR URL
- CI status (green)
- Review status
- What was fixed (if anything)

If in `--once` mode, exit here. Otherwise, loop back to step 2 to keep watching.
