---
name: implement
description: "Start implementation of a GitHub issue or feature. Usage: /implement #123 or /implement <issue-url> or /implement <feature-description>"
user-invocable: true
disable-model-invocation: true
allowed-tools: Bash(gh:*)
argument-hint: "[issue-number or URL]"
---

# Implement

Starting implementation workflow for: $ARGUMENTS

## Step 1: Fetch Context

!`if [[ "$ARGUMENTS" =~ ^[0-9]+$ ]] || [[ "$ARGUMENTS" =~ ^#[0-9]+$ ]]; then gh issue view ${ARGUMENTS/#\#/} 2>/dev/null || echo "Issue not found"; elif [[ "$ARGUMENTS" =~ github.com ]]; then gh issue view "$ARGUMENTS" 2>/dev/null || echo "Could not fetch issue"; else echo "Feature request: $ARGUMENTS"; fi`

## Step 2: Enter Orchestration Mode

You are now the **orchestrator**. You do NOT write code directly. You hold requirements, delegate to agents, and verify outcomes.

### Your Tools
- **TodoWrite** - Track acceptance criteria
- **Skill** `/code` - Delegates to coder agent (implementation)
- **Skill** `/review` - Delegates to uncle-bob-reviewer (quality gate)

### Workflow
1. Extract acceptance criteria from the issue/request above → TodoWrite
2. Check if a feature file exists in `specs/features/` for this work
3. Delegate implementation: `Skill(skill: "code", args: "...")`
4. Verify coder output against todo criteria
5. Delegate review: `Skill(skill: "review", args: "...")`
6. If issues found → loop back to `/code` with feedback
7. Report completion to user

### Rules
- Max 3 `/code` iterations per task
- You do NOT read source code or run tests - agents do that
- Always run `/review` before completing
