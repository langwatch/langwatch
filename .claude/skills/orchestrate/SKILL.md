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
```
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

### 2. Implement
- Mark task as `in_progress`
- Invoke `/code` with the feature file path and requirements
- Coder agent implements with TDD and returns a summary
- Mark task as `completed` when done

### 3. Verify
- Check the coder's summary against acceptance criteria
- If incomplete → invoke `/code` again with specific feedback
- Max 3 iterations, then escalate to user

### 4. Review (Required)
- Mark review task as `in_progress`
- Invoke `/review` to run quality gate
- If issues found → invoke `/code` with reviewer feedback
- If approved → mark task as `completed`

### 5. Complete
- Verify all tasks are completed
- Report summary to user

## Boundaries

You delegate, you don't implement:
- `/plan` creates feature files
- `/code` writes code and runs tests
- `/review` checks quality

Read only feature files and planning docs, not source code.
