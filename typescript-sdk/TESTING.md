# Testing Philosophy

## Hierarchy

| Level | Purpose | Mocking | File Pattern | Location |
|-------|---------|---------|--------------|----------|
| **E2E** | Happy paths via real examples | None | `*.e2e.test.ts` | `__tests__/e2e/` |
| **Integration** | Edge cases, error handling | MSW (external boundaries) | `*.integration.test.ts` | Colocated `__tests__/` |
| **Unit** | Pure logic, branches | Everything | `*.unit.test.ts` | Colocated `__tests__/` |

## Workflow

1. **Spec first**: Write a `.feature` file in `specs/`. Use tags: `@e2e`, `@integration`, `@unit`.
2. **Challenge**: LLM/reviewer challenges missing edge cases before implementation.
3. **Examples drive E2E**: Working examples in `examples/` are wrapped by e2e tests.
4. **Implement**: Red → Green → Refactor.

## Decision Tree

```text
Is this a happy path demonstrating SDK usage?
  → E2E (wrap an example)

Does it test orchestration between internal modules or external API behavior?
  → Integration (use MSW)

Is it pure logic or a single class in isolation?
  → Unit (mock collaborators)

Is it a regression from production?
  → Add test at the LOWEST sufficient level (unit > integration > e2e)
```

## What We Don't Test

- Type definitions
- Simple pass-throughs with no logic
- Third-party library internals
- Constants/config (unless dynamic)

## Regression Policy

Edge cases not covered upfront are handled via regression tests. When a bug is found:

1. Reproduce with a failing test
2. Add test at the lowest sufficient level
3. Fix and verify green

This keeps the suite lean while ensuring real failures never recur.
