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

## Flow

### 1. Plan (Required)
- Check if a feature file exists in `specs/features/`
- If not, invoke `/plan` to create one first
- Read the feature file to understand acceptance criteria
- Create tasks for each acceptance criterion

### 2. Test Review (Required)
- Invoke `/test-review` on the feature file
- Validates pyramid placement before any implementation begins
- Checks that `@e2e`, `@integration`, `@unit` tags are appropriate
- If violations found:
  - Update the feature file to fix tag placement
  - Re-run `/test-review` to confirm fixes
- If approved → proceed to Implement

### 3. Implement
- Mark task as `in_progress`
- Invoke `/code` with the feature file path and requirements
- Coder agent implements with TDD and returns a summary
- Mark task as `completed` when done

### 4. Verify
- Check the coder's summary against acceptance criteria
- If incomplete → invoke `/code` again with specific feedback
- Max 3 iterations, then escalate to user

### 5. Review (Required)
- Mark review task as `in_progress`
- Invoke `/review` to run quality gate
- If issues found → invoke `/code` with reviewer feedback
- If approved → mark task as `completed`

### 6. E2E Verification (Conditional)
- Check if feature file has `@e2e` tagged scenarios
- If yes:
  - Mark e2e task as `in_progress`
  - Invoke `/e2e` with the feature file path
  - E2E workflow: explores app → generates tests → runs until passing
  - If tests fail due to **test issues** → healer fixes them
  - If tests fail due to **app bugs** (behavior doesn't match spec):
    - Invoke `/code` with the failing scenario and expected vs actual behavior
    - After fix, re-run `/e2e` to verify
    - Max 2 iterations, then escalate to user
  - If all pass → mark task as `completed`
- If no `@e2e` scenarios → skip to Complete

### 7. Self-Check (Required)

Before completing, verify you didn't make mistakes:

**Review Compliance:**
- Did you address ALL items marked "Should fix (Important)"?
- Did you ask the user about items marked "NEEDS USER DECISION"?
- Did you skip any reviewer recommendations without justification?

**Test Coverage:**
- Check the feature file for `@unit`, `@integration`, `@e2e` tags
- Verify tests exist for EACH tagged scenario
- If a scenario is tagged `@integration` but only unit tests exist, that's incomplete

**Acceptance Criteria:**
- Re-read the feature file acceptance criteria
- Verify each criterion is implemented AND tested

If ANY check fails:
1. Do NOT proceed to Complete
2. Go back to the appropriate step (Implement, Review, or E2E)
3. Fix the gap before continuing

This self-check exists because it's easy to rationalize skipping work. Don't.

### 8. Complete
- Verify all tasks are completed
- Verify self-check passed
- Report summary to user (include E2E test status if applicable)

## Boundaries

You delegate, you don't implement:
- `/plan` creates feature files
- `/test-review` validates pyramid placement before implementation
- `/code` writes code and runs tests
- `/review` checks quality
- `/e2e` generates and verifies E2E tests

Read only feature files and planning docs, not source code.
