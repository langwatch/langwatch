---
name: review
description: "Run parallel code reviews: uncle-bob-reviewer (SOLID/TDD), cupid-reviewer (CUPID properties), test-reviewer (pyramid placement), and pii-reviewer (security/secrets). Surfaces conflicts for orchestrator resolution."
context: fork
user-invocable: true
argument-hint: "[focus-area or file-path]"
---

Run all four reviewers in parallel on the recent changes.

## Step 1: Parallel Reviews

Spawn ALL agents simultaneously using the **Agent tool** in a single message. Each agent MUST be a dedicated subagent — do NOT simulate their output yourself:

1. **uncle-bob-reviewer** (`subagent_type: "uncle-bob-reviewer"`): SOLID scan, TDD interrogation, clean code inspection
2. **cupid-reviewer** (`subagent_type: "cupid-reviewer"`): CUPID properties assessment (Composable, Unix, Predictable, Idiomatic, Domain-based)
3. **test-reviewer** (`subagent_type: "test-reviewer"`): Test pyramid placement, spec validation, naming conventions, flakiness vectors
4. **pii-reviewer** (`subagent_type: "pii-reviewer"`): PII exposure, hardcoded secrets, sensitive data in tests/logs

**IMPORTANT:** You MUST use `subagent_type` to invoke the actual agent definitions (`.claude/agents/*.md`). These agents have specific instructions and decision trees that you don't have. Do NOT role-play as the reviewers — delegate to them.

Focus area: $ARGUMENTS

## Step 2: Synthesize Results

After all complete, synthesize:

```
## Review Summary

### Uncle Bob (SOLID/Clean Code)
[Key findings]

### Dan North (CUPID)
[Key findings]

### Test Architect (Pyramid/Quality)
[Key findings on test placement, naming, and quality]

### Security (PII/Secrets)
[Key findings on sensitive data exposure]

### Conflicts Requiring Decision
[Any tensions between reviewers—these need user input]

### Agreed Improvements
[Recommendations all reviewers support]
```

## Step 3: Surface Conflicts

If reviewers disagree on approach (e.g., "extract this class" vs "keep it unified", or "this is E2E" vs "this is integration"):
- Clearly state all positions
- Explain the tradeoff
- Mark as **NEEDS USER DECISION** for the orchestrator to surface

Do not resolve design tradeoffs yourself—that's a human judgment call.
