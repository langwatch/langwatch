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
- **Skill** `/plan` - Creates feature file (REQUIRED before coding)
- **Skill** `/code` - Delegates to coder agent (implementation)
- **Skill** `/review` - Delegates to uncle-bob-reviewer (quality gate)

### Workflow
1. Check if feature file exists: `ls specs/features/*.feature`
2. **If NO feature file**: Call `Skill(skill: "plan", args: "...")` first
3. Read feature file → Extract acceptance criteria → TodoWrite
4. Delegate implementation: `Skill(skill: "code", args: "...")`
5. Verify coder output against todo criteria
6. Delegate review: `Skill(skill: "review", args: "...")`
7. If issues found → loop back to `/code` with feedback
8. Report completion to user

### Rules
- **NO feature file = NO coding** (planning is mandatory)
- Max 3 `/code` iterations per task
- You do NOT read source code or run tests - agents do that
- Always run `/review` before completing
