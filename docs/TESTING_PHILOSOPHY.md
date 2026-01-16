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

## What is a Feature?

A **Feature** is a user-facing capability that delivers value. Features are defined in `.feature` files using Gherkin syntax.

**Good feature names** (user capabilities):
- `scenario-library.feature` - Browse and filter scenarios
- `prompt-editor.feature` - Create and edit prompts
- `trace-viewer.feature` - Inspect execution traces

**Bad feature names** (milestones, implementation details):
- `walking-skeleton.feature` - This is a delivery milestone
- `m1-tasks.feature` - This is project management
- `refactor-auth.feature` - This is implementation work

A feature file should be **cohesive** - all scenarios relate to the same capability. When a feature grows too large or covers multiple capabilities, split it.

## Test Hierarchy

Avoid overlap. Each level tests different concerns.

| Level | Purpose | Mocking | Tool |
|-------|---------|---------|------|
| **E2E** | Full user journeys through the UI | None | Playwright |
| **Component** | React component behavior, hooks, interactions | External services | React Testing Library |
| **Integration** | API orchestration, service interactions | External boundaries only | Vitest |
| **Unit** | Pure logic, branches | Everything | Vitest |
| **Contract** | API boundary agreements (future) | N/A | Pact (not yet implemented) |

### When to Use Each Level

- **E2E**: Multi-page flows, authentication, critical happy paths
- **Component**: UI interactions, form validation, hook behavior, component state
- **Integration**: tRPC routers, service orchestration, database interactions
- **Unit**: Utility functions, pure transformations, business logic
- **Contract**: When services need to agree on API shapes (consumer-driven contracts)

### Agentic Smoke Testing vs Scripted Tests

AI agents with browser control enable two complementary approaches:

| Approach | Purpose | Speed | When |
|----------|---------|-------|------|
| **Agentic Exploration** | Discover issues, validate new features work | Slow (real-time) | Development, debugging, new features |
| **Scripted Playwright Tests** | Reproducible regression protection | Fast | CI, every PR |

The workflow: Agents **explore** to validate and discover issues, then **capture** what they find as scripted tests for speed and reproducibility.

### Tags

Use these tags in `.feature` files:

- `@e2e` - Full user journeys tested via Playwright
- `@component` - React component/hook tests via React Testing Library
- `@integration` - Service/API tests with mocked external boundaries
- `@unit` - Pure logic tests with full mocking

**Invalid tags**: `@visual`, `@manual`, `@skip` - if it can't be tested, it shouldn't be in a spec.

### Language-Specific Patterns

| Language | E2E | Component | Integration | Unit | Location |
|----------|-----|-----------|-------------|------|----------|
| TypeScript (UI) | `*.spec.ts` | `*.component.test.tsx` | - | - | `agentic-e2e-tests/`, `__tests__/` |
| TypeScript (API) | - | - | `*.integration.test.ts` | `*.unit.test.ts` | `__tests__/` |
| Python | `test_*_e2e.py` | - | `test_*_integration.py` | `test_*.py` | `tests/` |
| Go | `*_e2e_test.go` | - | `*_integration_test.go` | `*_test.go` | same package |

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

## Decision Tree

```text
Is this a multi-page user journey or critical happy path?
  → @e2e (Playwright in agentic-e2e-tests/)

Is this testing React component behavior, hooks, or UI interactions?
  → @component (React Testing Library)

Does it test API orchestration or external service behavior?
  → @integration (Vitest, mock external boundaries)

Is it pure logic or a single function/class in isolation?
  → @unit (Vitest, mock collaborators)

Is it a regression from production?
  → Add test at the LOWEST sufficient level (unit > component > integration > e2e)
```

## Agentic E2E Testing

E2E tests are authored and maintained by AI agents using the Playwright MCP tools.

### Workflow

```
specs/*.feature              Source of truth (Gherkin @e2e scenarios)
       │
       ▼
┌─────────────────┐
│    PLANNER      │  Reads @e2e scenarios, explores live app,
│                 │  creates detailed test plans
└────────┬────────┘
         │
         ▼
   plans/*.plan.md           Step-by-step test plans
         │
         ▼
┌─────────────────┐
│   GENERATOR     │  Executes steps in browser, records actions,
│                 │  writes Playwright test code
└────────┬────────┘
         │
         ▼
   tests/*.spec.ts           Executable Playwright tests
         │
         ▼
┌─────────────────┐
│    HEALER       │  Runs tests, debugs failures, fixes code,
│                 │  keeps tests passing as app evolves
└─────────────────┘
```

### Directory Structure

```
agentic-e2e-tests/
├── plans/              # Test plans (planner output)
├── tests/              # Playwright specs (generator output)
├── seeds/              # Entry point setup files
└── README.md           # Agent operating instructions
```

### When to Invoke Agents

| Trigger | Agent | Action |
|---------|-------|--------|
| New `@e2e` scenario in `.feature` | Planner | Create test plan |
| New test plan in `plans/` | Generator | Write `.spec.ts` |
| Test failure in CI | Healer | Debug and fix |
| UI changes break tests | Healer | Update selectors/assertions |

## Scenario Design

Each scenario tests **one invariant**.

- **Extend** (add `And`/`But`): The new assertion is a natural consequence of the same behavior
- **New scenario**: The assertion tests a distinct invariant that could fail independently

Example: "User can create scenario" and "User can filter by label" are orthogonal - separate scenarios.

## BDD Workflow

1. **Spec first**: Write a `.feature` file in `specs/` with appropriate tags
2. **Challenge**: Review for missing edge cases before implementation
3. **Implement**: Outside-in TDD (Red → Green → Refactor)
4. **E2E coverage**: For `@e2e` scenarios, invoke the agentic testing workflow

## What We Don't Test

- Type definitions
- Simple pass-throughs with no logic
- Third-party library internals
- Constants/config (unless dynamic)

## Regression Policy

When a bug is found in production:

1. Reproduce with a failing test
2. Add test at the lowest sufficient level
3. Fix and verify green

This keeps the suite lean while ensuring real failures never recur.
