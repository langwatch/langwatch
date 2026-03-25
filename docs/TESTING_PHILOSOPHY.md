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

## Coverage is Mandatory

Every change ships with tests. No exceptions. This is not aspirational — it is a hard requirement.

- **Bug fixes** must include a regression test that fails without the fix and passes with it. Tag with `@regression`.
- **New features** must have integration and/or unit tests covering all acceptance criteria from the feature spec.
- **Refactors** must not reduce existing test coverage.

Target near-100% coverage via integration + unit tests. E2E tests are deprioritized (see below).

## Test Hierarchy

Avoid overlap. Each level has a distinct purpose.

| Level | Purpose | Mocking | Quantity |
|-------|---------|---------|----------|
| **E2E** | Catastrophic regression detection for stable core flows | None | 5-10 total (deprioritized) |
| **Browser Verification** | Interactive feature validation during development | None | Per-feature, not persisted as tests |
| **Integration** | Edge cases, error handling, component rendering | External boundaries only | As many as needed |
| **Unit** | Pure logic, branches | Everything | As many as needed |

### E2E Tests: Deprioritized

E2E tests are expensive and brittle. The app's UI and API surface changes too fast for e2e tests to keep up — they break frequently and take too long to run, providing poor ROI.

We maintain a **minimal stable suite** (5-10 tests) that covers core happy paths of established features — sign in, view traces, run an evaluation. These run on a schedule or before releases, not per PR.

We do **not** generate E2E tests per feature. Interactive browser verification (`/browser-test`) provides development-time confidence without the maintenance burden. Integration and unit tests are the primary coverage mechanism. See [ADR-010](adr/010-e2e-testing-strategy.md) for the full rationale.

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

## Feature File Parity

Feature specs in `specs/` define what tests must exist. **Every scenario in a feature file must have a corresponding test implementation.** This is enforced — not aspirational.

### Convention

| Feature file | Test file |
|-------------|-----------|
| `specs/analytics/chart-rendering.feature` | `src/server/analytics/__tests__/chart-rendering.integration.test.ts` |
| `specs/scenarios/welcome-modal.feature` | `src/components/scenarios/__tests__/welcome-modal.integration.test.ts` |

The scenario title in the feature file should match the `it()` description in the test. Use `describe("Feature: <feature name>")` as the outer block.

### Tags

| Tag | Meaning | Use when |
|-----|---------|----------|
| `@unit` | Pure logic test | Testing functions, utilities, transformations |
| `@integration` | Component/boundary test | Testing rendering, API calls, DB queries |
| `@regression` | Prevents a previously-fixed bug from recurring | Bug fix scenarios — must fail without the fix |
| `@e2e` | Stable core flow (deprioritized) | Only for the 5-10 stable happy-path tests |

Bug-fix feature specs should use `@regression` (alongside `@unit` or `@integration` for pyramid level):

```gherkin
@regression @integration
Scenario: Analytics chart shows error state when ClickHouse query fails
  Given an analytics dashboard with a configured chart
  When the ClickHouse query returns a memory limit error
  Then the chart displays an error badge with a retry option
```

## Workflow

See `specs/README.md` for detailed BDD guidance.

1. **Spec first**: Write a `.feature` file in `specs/`. Use tags: `@integration`, `@unit`, `@regression`.
2. **Challenge**: LLM/reviewer challenges missing edge cases before implementation.
3. **Implement**: Outside-in TDD. Red -> Green -> Refactor.
4. **Browser verify**: Use `/browser-test` to validate the feature works in a real browser.

## Decision Tree

Apply in order. Stop at first match.

```text
Is this a core happy path of a stable, established feature?
  -> @e2e (only if not already covered by the stable suite)

Is this testing UI elements exist? (form fields, buttons, layout)
  -> @integration

Is this testing navigation/routing only?
  -> @integration

Is this testing error handling or edge cases?
  -> @integration (mock boundaries)

Is this a complete user workflow for a new/changing feature?
  -> @integration + /browser-test for visual verification

Is this pure logic in isolation?
  -> @unit

Is this a regression from production?
  -> Add at LOWEST sufficient level (unit > integration > e2e)
```

### When to Use Each Approach

| Situation | Approach |
|-----------|----------|
| New feature during development | `/browser-test` for interactive verification |
| Bug fix verification | `/browser-test` to confirm the fix works |
| Core sign-in/dashboard/traces flow broke | Stable E2E suite catches this |
| Form renders correct fields | `@integration` test |
| API returns correct data | `@unit` or `@integration` test |

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

The stable E2E suite lives in `agentic-e2e-tests/`. These tests cover core happy paths only.

| Pattern | Convention |
|---------|------------|
| Sidebar navigation | Always use `{ name: 'X', exact: true }` |
| Dialogs (Chakra) | Use `.last()` to handle duplicate renders |
| Auth state | Stored in `.auth/user.json`, reused across tests |
| Test naming | Action-based, no "should" (see `CLAUDE.md`) |
| Test credentials | `browser-test@langwatch.ai` / `BrowserTest123!` (consistent across scripts and tests) |

See `agentic-e2e-tests/README.md` for setup and running tests.

## Browser Verification

Interactive browser verification (`/browser-test`) replaces per-feature E2E test generation. An AI agent drives a real browser, walks through scenarios, takes screenshots, and reports results.

Artifacts are saved to `browser-tests/<feature-name>/<YYYY-MM-DD>/` with screenshots and a report. These are committed to the branch and linked in PR descriptions.

See `.claude/skills/browser-test/SKILL.md` for the full workflow and `browser-tests/proof-of-concept/` for an example run.
