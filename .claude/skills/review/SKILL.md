---
name: review
description: "Run parallel code reviews: uncle-bob-reviewer (SOLID/TDD/clean code) and cupid-reviewer (CUPID properties). Surfaces conflicts for orchestrator resolution."
context: fork
user-invocable: true
argument-hint: "[focus-area or file-path]"
---

Run both reviewers in parallel on the recent changes.

## Step 1: Parallel Reviews

Spawn BOTH agents simultaneously using the Task tool in a single message:

1. **uncle-bob-reviewer**: SOLID scan, TDD interrogation, clean code inspection
2. **cupid-reviewer**: CUPID properties assessment (Composable, Unix, Predictable, Idiomatic, Domain-based)

Focus area: $ARGUMENTS

## Step 2: Synthesize Results

After both complete, synthesize:

```
## Review Summary

### Uncle Bob (SOLID/Clean Code)
[Key findings]

### Dan North (CUPID)
[Key findings]

### Conflicts Requiring Decision
[Any tensions between SOLID and CUPID recommendations—these need user input]

### Agreed Improvements
[Recommendations both reviewers support]
```

## Step 3: Surface Conflicts

If reviewers disagree on approach (e.g., "extract this class" vs "keep it unified"):
- Clearly state both positions
- Explain the tradeoff
- Mark as **NEEDS USER DECISION** for the orchestrator to surface

Do not resolve design tradeoffs yourself—that's a human judgment call.
