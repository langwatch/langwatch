---
name: implement
description: "Start implementation of a GitHub issue. Usage: /implement #123 or /implement <issue-url>"
user-invocable: true
disable-model-invocation: true
allowed-tools: Bash(gh:*)
argument-hint: "[issue-number or URL]"
---

# Implement

Starting implementation workflow for: $ARGUMENTS

## Step 1: Fetch GitHub Issue

Work should be tied to a GitHub issue for tracking. Fetching issue context:

!`if [[ "$ARGUMENTS" =~ ^[0-9]+$ ]] || [[ "$ARGUMENTS" =~ ^#[0-9]+$ ]]; then gh issue view ${ARGUMENTS/#\#/} 2>/dev/null || echo "Issue not found - please provide a valid issue number"; elif [[ "$ARGUMENTS" =~ github.com ]]; then gh issue view "$ARGUMENTS" 2>/dev/null || echo "Could not fetch issue"; else echo "No issue number provided. Please use /implement #123 or create an issue first."; fi`

## Step 2: Enter Orchestration Mode

Now invoke the orchestrator, passing the issue title and description from Step 1:

```
Skill(skill: "orchestrate", args: "Issue #N: <title>\n\n<issue body/description>")
```

The orchestrator will manage the full implementation loop:
1. `/plan` - Create feature file with acceptance criteria
2. `/code` - Delegate implementation to coder agent
3. `/review` - Quality gate with uncle-bob-reviewer
4. Loop until complete
