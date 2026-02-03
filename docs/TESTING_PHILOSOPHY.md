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

### Describe Block Naming

Use MDN-style naming for the unit under test:

| Type | Format | Example |
|------|--------|---------|
| Function | `name()` | `describe("transformData()", ...)` |
| Class | `Name` | `describe("Analytics", ...)` |
| Component | `<Name/>` | `describe("<DatePicker/>", ...)` |
| Hook | `useName()` | `describe("useFeatureFlag()", ...)` |

### Nested Describe for Context

Use nested `describe` blocks to group tests by context/condition. The outer `describe` names the unit under test, inner `describe` blocks specify the "when" condition, and `it` blocks describe the behavior.

```typescript
describe("useFeatureFlag()", () => {
  describe("when flag is enabled", () => {
    it("returns true", () => {
      // ...
    });
  });

  describe("when query is loading", () => {
    it("returns false", () => {
      // ...
    });
  });
});
```

See [bettertests.js.org](https://bettertests.js.org/) for more patterns.

### Single Expectation Per Test

Isolating assertions makes failures immediately clear. When multiple behaviors need testing, create separate tests.

### BDD-Style Test Structure

Use nested `describe` blocks to express Given/When/Then structure:

```typescript
describe("ClassName", () => {
  describe("methodName", () => {
    describe("given some precondition", () => {
      beforeEach(() => { /* setup context */ });

      describe("when some action occurs", () => {
        it("produces expected result", () => { /* assertion */ });
        it("also does this other thing", () => { /* assertion */ });
      });
    });

    describe("given different precondition", () => {
      describe("when same action occurs", () => {
        it("produces different result", () => { /* assertion */ });
      });
    });
  });
});
```

Benefits:
- **Grouping**: Related tests share setup in `beforeEach`
- **Readability**: Test output reads like a spec: "ClassName > methodName > given X > when Y > does Z"
- **Organization**: Clear separation of context (given) from action (when) from expectation (it)

Avoid flat structures with Given/When/Then only in comments:
```typescript
// Avoid: comments don't provide grouping or shared setup
it("does X when Y given Z", () => {
  // Given: Z
  // When: Y
  // Then: X
});
```

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

See `specs/README.md` for detailed BDD guidance.

1. **Spec first**: Write a `.feature` file in `specs/`. Use tags: `@e2e`, `@integration`, `@unit` only.
2. **Challenge**: LLM/reviewer challenges missing edge cases before implementation.
3. **Examples drive E2E**: Working examples in `examples/` are wrapped by E2E tests.
4. **Implement**: Outside-in TDD. Red -> Green -> Refactor.

## Decision Tree

Apply in order. Stop at first match.

```text
Is this testing UI elements exist? (form fields, buttons, layout)
  -> @integration

Is this testing navigation/routing only?
  -> @integration

Is this testing error handling or edge cases?
  -> @integration (mock boundaries)

Is this a complete user workflow with observable outcome?
  -> @e2e (user intent + multiple steps + result + business value)

Is this pure logic in isolation?
  -> @unit

Is this a regression from production?
  -> Add at LOWEST sufficient level (unit > integration > e2e)
```

### Examples

**Valid @e2e** - Complete workflow:
```gherkin
@e2e
Scenario: User creates and publishes a scenario
  Given I am logged in
  When I create a new scenario
  And I fill in the required fields
  And I save the scenario
  Then I see a success message
  And the scenario appears in my list after refresh
```

**Invalid @e2e** - Should be @integration:
```gherkin
@e2e  # WRONG: just testing UI exists
Scenario: Create form has required fields
  Given I am on the create page
  Then I see a name field
  And I see a submit button
```

Use `/test-review` to validate pyramid placement.

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

## E2E Patterns (Playwright)

Project-specific conventions for `agentic-e2e-tests/`:

| Pattern | Convention |
|---------|------------|
| Sidebar navigation | Always use `{ name: 'X', exact: true }` |
| Dialogs (Chakra) | Use `.last()` to handle duplicate renders |
| Auth state | Stored in `.auth/user.json`, reused across tests |
| Test naming | Action-based, no "should" (see `CLAUDE.md`) |

### Agentic Workflow

```text
specs/*.feature → Planner → plans/*.plan.md → Generator → tests/*.spec.ts
                                                              ↓
                                                          Healer (on failure)
```

- Specs are source of truth
- Plans are generated by exploring live app
- Tests are generated from plans
- Healer fixes failing tests by inspecting UI

See `agentic-e2e-tests/README.md` for setup and running tests.
