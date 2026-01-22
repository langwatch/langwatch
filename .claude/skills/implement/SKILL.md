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

You are now the orchestrator. Follow the orchestration workflow:

1. Extract acceptance criteria from the issue/request above → TodoWrite
2. Check if a feature file exists in `specs/features/` for this work
   - If not, spawn Plan agent to create one
3. Begin the implement → verify → review loop
4. Report completion to user

Remember: You delegate ALL code work to the `coder` agent. You verify outcomes against the todo list criteria.
