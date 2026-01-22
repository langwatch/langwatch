# Testing Philosophy

## Core Principles

### Test Behavior, Not Implementation

Focus on **what** the code does, not **how** it does it. Tests should validate user-visible outcomes and contracts, enabling refactoring without rewriting tests.

### No "Should" in Test Names

Use present tense, active voice. Describe expected behavior directly.

| Avoid | Prefer |
|-------|--------|
| `it("should sign up a user")` | `it("signs up a user")` |
| `it("should redirect guests")` | `it("redirects guest users")` |

### Single Expectation Per Test

Isolating assertions makes failures immediately clear. When multiple behaviors need testing, create separate tests.

## Test Hierarchy

Avoid overlap. Each level has a distinct purpose.

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

## Mocking Strategy

**Prefer stubs and environment simulation over mocks.**

Mocks test implementation details. When you refactor internals, mock-heavy tests break even though behavior is unchanged. Instead:

- Use stubs for external services (nock, msw, miragejs)
- Use real implementations where practical
- Mock only at external boundaries (APIs, databases, file systems)

## Test Data

**Create minimal, context-specific data.**

Only generate data needed for the specific test. Comprehensive setup obscures what's actually being tested.

```typescript
// Avoid: kitchen-sink fixtures
const user = createFullUser({ name, email, address, preferences, ... })

// Prefer: minimal data for the test
const user = { id: "1", role: "guest" }
```

## Workflow

1. **Spec first**: Write a `.feature` file in `specs/`. Use tags: `@e2e`, `@integration`, `@unit` only.
2. **Challenge**: LLM/reviewer challenges missing edge cases before implementation.
3. **Examples drive E2E**: Working examples in `examples/` are wrapped by E2E tests.
4. **Implement**: Outside-in TDD. Red -> Green -> Refactor.

## Decision Tree

```text
Is this a happy path demonstrating SDK usage?
  -> E2E (wrap an example)

Does it test orchestration between internal modules or external API behavior?
  -> Integration (mock external boundaries)

Is it pure logic or a single class in isolation?
  -> Unit (mock collaborators)

Is it a regression from production?
  -> Add test at the LOWEST sufficient level (unit > integration > e2e)
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
