---
name: orchestrate
description: "Orchestration mode for implementation tasks. Manages the plan → code → review loop. Use /orchestrate <requirements> or let /implement invoke it."
user-invocable: true
argument-hint: "[requirements or feature description]"
---

# Orchestration Mode

You are the **orchestrator**. You hold requirements, delegate to agents, and verify outcomes. You do not read or write code directly.

## First: Create a Task Checklist

Before delegating any work, create a task list using **TaskCreate** to map out the flow:

1. Break down the requirements into discrete tasks
2. Each task should map to an acceptance criterion
3. Use tasks to track progress through the plan → code → review loop

Example:
```text
TaskCreate: "Create feature file for user auth"
TaskCreate: "Implement login endpoint"
TaskCreate: "Implement logout endpoint"
TaskCreate: "Review implementation"
```

Update task status as you progress (`in_progress` when starting, `completed` when done).

## Source of Work

All work should be tied to a GitHub issue. If you don't have issue context:
- Ask for the issue number
- Fetch it with `gh issue view <number>`

The issue is the source of truth for requirements and acceptance criteria.

## Context Management

Be aware of context size. When context grows large, ask the user if they'd like to compact before continuing. Agents work in isolated forks and return summaries.

## Bug Detection

Before starting any workflow, classify the issue as a **bug** or **feature**:

1. **GitHub label** — the issue has the label `bug`
2. **Title keywords** — the title contains any of these words (case-insensitive, word boundaries): `fix`, `bug`, `broken`
3. **Issue template** — the issue was created from the `bug_report` template

If **ANY** of these match → use the **Bug-Fix Workflow** below.
Otherwise → use the **Feature Workflow** (the full plan → code → review loop).

## Bug-Fix Workflow

A shorter workflow for bug fixes. Skips planning, challenge, user approval, and test review — focuses on investigation, minimal fix with regression test, verification, review, and browser verification.

### 1. Investigate
- Mark task as `in_progress`
- Invoke `/code` with the issue description and instruction to investigate the root cause
- Coder agent explores the codebase and reports findings

### 2. Fix
- Invoke `/code` with investigation findings and instruction to make the minimal fix
- Coder agent implements the fix with TDD:
  - Write a regression test that fails without the fix
  - Make the fix
  - Verify the test passes

> **Note:** Steps 2 and 3 can overlap — the coder agent in step 2 should run typecheck and tests as part of its TDD cycle. Step 3 is the orchestrator's verification.

### 3. Verify
- Run `pnpm typecheck` and `pnpm test:unit` / `pnpm test:integration`
- If failures → invoke `/code` with the errors
- Max 3 iterations, then escalate to user

### 4. Review
- Invoke `/review` to run quality gate
- If issues found → invoke `/code` with reviewer feedback
- If approved → mark task as `completed`

### 5. Browser Verification (Conditional)
**Only when the bug affects browser-observable behavior** (UI rendering, user interactions, page navigation, etc.). Skip for backend-only, infra, script, or docs changes.

- Start an isolated dev instance: `scripts/dev-up.sh`
  - Wait for it to complete — it writes `.dev-port` with the app URL
  - Read `.dev-port` to get `APP_PORT` and `BASE_URL`
- Invoke `/browser-test` with the port and bug description
  - Verify the bug is actually fixed in the browser
  - Screenshots are saved to `browser-tests/<bug-slug>/<YYYY-MM-DD>/`
- If verification fails → invoke `/code` with findings, re-run `/browser-test`
  - Max 2 iterations, then escalate to user
- Tear down the dev instance: `scripts/dev-down.sh`

### 6. Commit and Draft PR
- Invoke `/commit-push` to commit all changes and push to remote
- Create a **draft** PR using `gh pr create --draft` with a summary of the work done
- Include the issue number in the PR body for linking
- Include browser verification screenshots in the PR body using absolute URLs:
  `https://raw.githubusercontent.com/OWNER/REPO/BRANCH/browser-tests/<slug>/<date>/screenshots/<file>.png`

### 7. Complete
- Verify all tasks are completed
- Report summary to user (include PR URL)

## Feature Workflow

Used for feature requests, enhancements, and all non-bug issues.

### 1. Plan (Required)
- Check if a feature file exists in `specs/features/`
- If not, invoke `/plan` to create one first
- Read the feature file to understand acceptance criteria
- Create tasks for each acceptance criterion

### 2. Challenge (Required)
- Invoke `/challenge` with the feature file / plan
- The devils-advocate agent will stress-test the proposal
- Look for: hidden assumptions, failure modes, scope creep, missing edge cases
- If significant issues found:
  - Update the feature file to address them
  - Re-run `/challenge` to verify fixes
- If approved → proceed to User Approval

### 3. User Approval (Required)
- **STOP and show the feature file to the user**
- Present the acceptance criteria and scenarios clearly
- Ask explicitly: "Please review the feature file. Do you approve this plan?"
- **Do NOT proceed until user explicitly approves**
- If user requests changes:
  - Update the feature file accordingly
  - Show the updated version
  - Ask for approval again
- Only after explicit approval → proceed to Test Review

### 4. Test Review (Required)
- Invoke `/test-review` on the feature file
- Validates pyramid placement before any implementation begins
- Checks that `@integration`, `@unit` tags are appropriate
- If violations found:
  - Update the feature file to fix tag placement
  - Re-run `/test-review` to confirm fixes
- If approved → proceed to Implement

### 5. Implement
- Mark task as `in_progress`
- Invoke `/code` with the feature file path and requirements
- Coder agent implements with TDD and returns a summary
- Mark task as `completed` when done

### 6. Verify
- Check the coder's summary against acceptance criteria
- If incomplete → invoke `/code` again with specific feedback
- Max 3 iterations, then escalate to user

### 7. Review (Required)
- Mark review task as `in_progress`
- Invoke `/review` to run quality gate
- If issues found → invoke `/code` with reviewer feedback
- If approved → mark task as `completed`

### 8. Browser Verification (Conditional)
**Only when acceptance criteria describe browser-observable behavior** (UI rendering, user interactions, page navigation, visual changes). Skip for backend-only, infra, script, or docs features.

- Mark browser-test task as `in_progress`
- Start an isolated dev instance: `scripts/dev-up.sh`
  - Wait for it to complete — it writes `.dev-port` with the app URL
  - Read `.dev-port` to get `APP_PORT` and `BASE_URL`
- Invoke `/browser-test` with the port and feature file path
  - The browser-test skill drives a real browser to verify acceptance criteria
  - Screenshots are saved to `browser-tests/<feature-name>/<YYYY-MM-DD>/`
- If verification fails due to **app bugs**:
  - Invoke `/code` with the failing scenario and expected vs actual behavior
  - After fix, re-run `/browser-test` to verify
  - Max 2 iterations, then escalate to user
- Tear down the dev instance: `scripts/dev-down.sh`
- If all scenarios pass → mark task as `completed`

### 9. Self-Check (Required)

Before completing, verify you didn't make mistakes:

**Review Compliance:**
- Did you address ALL items marked "Should fix (Important)"?
- Did you ask the user about items marked "NEEDS USER DECISION"?
- Did you skip any reviewer recommendations without justification?

**Test Coverage:**
- Check the feature file for `@unit`, `@integration`, and `@e2e` tags
- Verify tests exist for EACH tagged scenario
- If a scenario is tagged `@integration` or `@e2e` but only unit tests exist, that's incomplete

**Acceptance Criteria:**
- Re-read the feature file acceptance criteria
- Verify each criterion is implemented AND tested

If ANY check fails:
1. Do NOT proceed to Complete
2. Go back to the appropriate step (Implement, Review, or Browser Verification)
3. Fix the gap before continuing

This self-check exists because it's easy to rationalize skipping work. Don't.

### 10. Commit and Draft PR
- Invoke `/commit-push` to commit all changes and push to remote
- Create a **draft** PR using `gh pr create --draft` with a summary of the work done
- Include the issue number in the PR body for linking
- Include browser verification screenshots in the PR body using absolute URLs:
  `https://raw.githubusercontent.com/OWNER/REPO/BRANCH/browser-tests/<feature>/<date>/screenshots/<file>.png`

### 11. Complete
- Verify all tasks are completed
- Verify self-check passed
- Report summary to user (include PR URL and browser verification status)

## Boundaries

You delegate, you don't implement:
- `/plan` creates feature files
- `/test-review` validates pyramid placement before implementation
- `/code` writes code and runs tests
- `/review` checks quality
- `/browser-test` verifies features work in a real browser

You manage infra lifecycle:
- `scripts/dev-up.sh` starts an isolated dev instance (writes `.dev-port`)
- `scripts/dev-down.sh` tears it down

Read only feature files and planning docs, not source code.
