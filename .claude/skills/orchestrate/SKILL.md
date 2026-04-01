---
name: orchestrate
description: "Orchestration mode for implementation tasks. Manages the plan → code → browser-verify loop. Use /orchestrate <requirements> or let /implement invoke it."
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

## PR Lifecycle (Push Early, Draft Early)

Every implementation — bug fix or feature — follows this PR lifecycle:

1. **First commit → push + draft PR immediately.** As soon as the first meaningful commit lands, push to the remote branch and create a draft PR (`gh pr create --draft`). Include the issue number in the body for linking. This makes work visible early.
2. **Push incrementally.** After each subsequent commit (fix, review feedback, etc.), push to keep the remote up to date.
3. **Mark ready when done.** Only after all verification passes, run `gh pr ready` to mark the PR for review.

Do NOT wait until the end to create the PR. The draft PR is created right after the first commit, not at completion.

---

## Bug Detection

Before starting any workflow, classify the issue as a **bug** or **feature**:

1. **GitHub label** — the issue has the label `bug`
2. **Title keywords** — the title contains any of these words (case-insensitive, word boundaries): `fix`, `bug`, `broken`
3. **Issue template** — the issue was created from the `bug_report` template

If **ANY** of these match → use the **Bug-Fix Workflow** below.
Otherwise → use the **Feature Workflow** (the full plan → code → review loop).

## Bug-Fix Workflow

A shorter workflow for bug fixes. Skips planning, challenge, and user approval — focuses on investigation, minimal fix with regression test, verification, and browser verification.

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

**Choose the right test level for the regression test.** "Reproduces the bug" means the test triggers the same failure mode the user reported — not just inspecting generated output:
- If the bug is a **runtime crash or query error**: the test must execute the code path that crashes (integration test). A unit test asserting string output does NOT reproduce a runtime crash.
- If the bug is **wrong output or wrong behavior**: a unit test checking output may be sufficient.
- If the bug is a **UI rendering issue**: a browser test is needed.
- **Rule of thumb:** if the bug report says "X crashes/errors at runtime," the regression test must execute X and observe the crash. String-level assertions on generated code are supplementary, not primary.

> **Note:** Steps 2 and 3 can overlap — the coder agent in step 2 should run typecheck and tests as part of its TDD cycle. Step 3 is the orchestrator's verification.

### 3. Verify
- Run `pnpm typecheck` and `pnpm test:unit` / `pnpm test:integration`
- If failures → invoke `/code` with the errors
- Max 3 iterations, then escalate to user

### 4. Browser Verification (Conditional)
**Only when the bug affects browser-observable behavior** (UI rendering, user interactions, page navigation, etc.). Skip for backend-only, infra, script, or docs changes.

- Invoke `/browser-test` with the bug description
  - `/browser-test` handles everything: dev instance lifecycle, browser verification, screenshots, commit/push, and PR description update
- If verification fails → invoke `/code` with findings, re-run `/browser-test`
  - Max 2 iterations, then escalate to user

### 6. Finalize and Mark Ready
- Mark PR as ready for review: `gh pr ready`
- Invoke `/drive-pr --once` to fix any CI failures and address review comments

### 7. Verify and Finish

Before reporting done, run through this checklist. **Every item must pass** — if any fails, go back to the appropriate step.

**Deliverables:**
- [ ] All tasks in the task list are marked `completed`
- [ ] `git status` is clean — no uncommitted changes
- [ ] `git push` is up to date with remote — no unpushed commits
- [ ] Draft PR was created after first commit and is now marked ready

**Quality:**
- [ ] `pnpm typecheck` passes
- [ ] All relevant tests pass (`pnpm test:unit`, `pnpm test:integration`)
- [ ] Regression test exists for the bug fix
- [ ] Regression test level matches the failure mode (runtime crash → integration test, not unit test checking strings)

**PR completeness:**
- [ ] PR description includes what the bug was and how it was fixed
- [ ] If browser-test ran: screenshots are visible in the PR body (not just local files)
- [ ] CI is green or only has expected pending checks (e.g. `check-approval-or-label`)

**Issue alignment:**
- [ ] Re-read the original issue — does the fix actually address the reported problem?
- [ ] Are there any acceptance criteria in the issue that aren't covered?

If everything passes → report summary to user (include PR URL). If anything fails → fix it first.

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
- Only after explicit approval → proceed to Implement

### 4. Implement
- Mark task as `in_progress`
- Invoke `/code` with the feature file path and requirements
- Coder agent implements with TDD and returns a summary
- Mark task as `completed` when done

### 5. Verify
- Check the coder's summary against acceptance criteria
- If incomplete → invoke `/code` again with specific feedback
- Max 3 iterations, then escalate to user

### 6. Browser Verification (Conditional)
**Only when acceptance criteria describe browser-observable behavior** (UI rendering, user interactions, page navigation, visual changes). Skip for backend-only, infra, script, or docs features.

- Mark browser-test task as `in_progress`
- Invoke `/browser-test` with the feature file path
  - `/browser-test` handles everything: dev instance lifecycle, browser verification, screenshots, commit/push, and PR description update
- If verification fails due to **app bugs**:
  - Invoke `/code` with the failing scenario and expected vs actual behavior
  - After fix, re-run `/browser-test` to verify
  - Max 2 iterations, then escalate to user
- If all scenarios pass → mark task as `completed`

### 7. Self-Check (Required)

Before completing, verify you didn't make mistakes:

**Test Coverage:**
- Check the feature file for `@unit`, `@integration`, and `@e2e` tags
- Verify tests exist for EACH tagged scenario
- If a scenario is tagged `@integration` or `@e2e` but only unit tests exist, that's incomplete

**Acceptance Criteria:**
- Re-read the feature file acceptance criteria
- Verify each criterion is implemented AND tested

If ANY check fails:
1. Do NOT proceed to Complete
2. Go back to the appropriate step (Implement or Browser Verification)
3. Fix the gap before continuing

This self-check exists because it's easy to rationalize skipping work. Don't.

### 8. Finalize and Mark Ready
- Mark PR as ready for review: `gh pr ready`
- Invoke `/drive-pr --once` to fix any CI failures and address review comments

### 9. Verify and Finish

Before reporting done, run through this checklist. **Every item must pass** — if any fails, go back to the appropriate step.

**Deliverables:**
- [ ] All tasks in the task list are marked `completed`
- [ ] Self-check (step 7) passed
- [ ] `git status` is clean — no uncommitted changes
- [ ] `git push` is up to date with remote — no unpushed commits
- [ ] Draft PR was created after first commit and is now marked ready

**Quality:**
- [ ] `pnpm typecheck` passes
- [ ] All relevant tests pass (`pnpm test:unit`, `pnpm test:integration`)
- [ ] Test coverage matches feature file tags (`@unit`, `@integration`, `@e2e`)

**PR completeness:**
- [ ] PR description summarizes the feature and links to the issue
- [ ] If browser-test ran: screenshots are visible in the PR body (not just local files)
- [ ] CI is green or only has expected pending checks (e.g. `check-approval-or-label`)

**Spec alignment:**
- [ ] Re-read the feature file — every scenario is implemented and tested
- [ ] Re-read the original issue — every acceptance criterion is covered
- [ ] No TODO comments left in the code for work that should have been done

If everything passes → report summary to user (include PR URL and browser verification status). If anything fails → fix it first.

## Boundaries

You delegate, you don't implement:
- `/plan` creates feature files
- `/code` writes code and runs tests
- `/browser-test` verifies features work in a real browser
- `/drive-pr` fixes CI failures and addresses review comments

You manage infra lifecycle:
- `scripts/dev-up.sh` starts an isolated dev instance (writes `.dev-port`)
- `scripts/dev-down.sh` tears it down

Read only feature files and planning docs, not source code.
