# Testing Philosophy

## Hierarchy

Avoid overlap. integration tests should not test the same thing as e2e tests, and unit tests should not test the same thing as integration tests.

| Level | Purpose | Mocking |
|-------|---------|---------|
| **E2E** | Happy paths via real examples | None |
| **Integration** | Edge cases, error handling | External boundaries only |
| **Unit** | Pure logic, branches | Everything |

### Language-Specific Patterns

| Language | E2E | Integration | Unit | Location |
|----------|-----|-------------|------|----------|
| TypeScript | `*.e2e.test.ts` | `*.integration.test.ts` | `*.unit.test.ts` | `__tests__/` |
| Python | `test_*_e2e.py` | `test_*_integration.py` | `test_*.py` | `tests/` |
| Go | `*_e2e_test.go` | `*_integration_test.go` | `*_test.go` | same package |

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
  → Integration (mock external boundaries)

Is it pure logic or a single class in isolation?
  → Unit (mock collaborators)

Is it a regression from production?
  → Add test at the LOWEST sufficient level (unit > integration > e2e)
```

## Scenario Design

Each scenario should test **one invariant**. When deciding whether to extend an existing scenario or create a new one:

- **Extend** (add `And`/`But`): The new assertion is a natural consequence of the same behavior
- **New scenario**: The assertion tests a distinct invariant that could fail independently

Example: "Cache returns stale data" and "Cache key includes version" are orthogonal invariants — separate scenarios. If one fails, you immediately know which contract broke.

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
