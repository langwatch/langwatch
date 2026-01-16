# Agentic E2E Tests

AI-maintained end-to-end tests for LangWatch using Playwright.

## Overview

This directory contains E2E tests that are **authored and maintained by AI agents**. The workflow uses three specialized agents:

| Agent | Role | When Invoked |
|-------|------|--------------|
| **Planner** | Explores the app, creates detailed test plans | New `@e2e` scenario in `.feature` file |
| **Generator** | Executes steps in browser, writes `.spec.ts` | New test plan in `plans/` |
| **Healer** | Debugs failures, fixes broken tests | Test failure in CI or locally |

### Agentic Exploration vs Scripted Tests

Agents enable two complementary testing modes:

| Mode | Speed | Purpose |
|------|-------|---------|
| **Exploration** | Slow (real-time) | Validate new features, discover issues, smoke testing |
| **Scripted Tests** | Fast | Reproducible regression protection in CI |

The workflow: Agents **explore** the app to validate functionality and discover edge cases, then **capture** what they find as scripted Playwright tests for speed and reproducibility in CI.

## Directory Structure

```
agentic-e2e-tests/
├── plans/              # Test plans (planner output)
│   └── scenarios/      # Plans for scenarios feature
├── tests/              # Playwright specs (generator output)
│   └── scenarios/      # Tests for scenarios feature
├── seeds/              # Entry point setup files
├── .auth/              # Auth state (gitignored)
├── playwright.config.ts
├── package.json
└── README.md
```

## Workflow

### 1. Spec First (Human)

Define what to test in a `.feature` file:

```gherkin
# specs/scenarios/scenario-library.feature
@e2e
Scenario: User can create a new scenario
  Given I am logged in
  When I navigate to the scenarios page
  And I click "New Scenario"
  And I fill in the scenario form
  And I click "Save"
  Then I see the scenario in the list
```

### 2. Planner Agent

The planner reads `@e2e` scenarios and creates detailed test plans:

```markdown
# plans/scenarios/create-scenario.plan.md

## Test: User can create a new scenario
Seed: seeds/scenarios-list.seed.ts

### Steps:
1. Click "New Scenario" button
2. Fill "Name" field with "Test Scenario"
3. Fill "Situation" textarea with "User wants help"
4. Click "Add Criterion" button
5. Fill criterion with "Agent responds helpfully"
6. Click "Save" button

### Expected Results:
- Redirect to scenarios list
- "Test Scenario" appears in the list
```

### 3. Generator Agent

The generator executes the plan in a real browser and writes the test:

```typescript
// tests/scenarios/create-scenario.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Scenario Library", () => {
  test("User can create a new scenario", async ({ page }) => {
    // 1. Click "New Scenario" button
    await page.getByRole("button", { name: "New Scenario" }).click();

    // 2. Fill "Name" field
    await page.getByLabel("Name").fill("Test Scenario");

    // ... rest of steps
  });
});
```

### 4. Healer Agent

When tests fail, the healer:
1. Runs the failing test with `--debug`
2. Analyzes the error and page state
3. Updates selectors, assertions, or waits
4. Verifies the fix

## Running Tests

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run with UI (interactive)
pnpm test:ui

# Run specific test file
pnpm test tests/scenarios/create-scenario.spec.ts

# Debug a failing test
pnpm test:debug
```

## Authentication

Tests require authentication. The setup project handles this:

1. **First run**: Creates `.auth/user.json` with session state
2. **Subsequent runs**: Reuses the auth state

For CI, set these environment variables:
- `TEST_USER_EMAIL` - Test account email
- `TEST_USER_PASSWORD` - Test account password

## Test Environment

Tests use **isolated ports** to avoid interfering with local development:

| Service | Dev Port | Test Port |
|---------|----------|-----------|
| App | 5560 | 5561 |
| Postgres | 5432 | 5433 |
| Redis | 6379 | 6380 |
| Elasticsearch | 9200 | 9201 |

### Running Test Environment

```bash
# Start test services (from repo root)
docker compose -f compose.test.yml up -d

# Run tests against test environment
BASE_URL=http://localhost:5561 pnpm test
```

## CI Integration

Tests run in GitHub Actions with:
- Services: postgres, redis, elasticsearch (test ports)
- App: Built Docker image on port 5561
- Browser: Chromium (+ Firefox on CI)

See `.github/workflows/langwatch-app-ci.yml` for the full configuration.

## Seed Files

Seed files set up the initial state for tests:

```typescript
// seeds/scenarios-list.seed.ts
import { test as setup } from "@playwright/test";

setup("navigate to scenarios list", async ({ page }) => {
  await page.goto("/my-project/simulations");
  await page.waitForSelector('[data-testid="scenarios-list"]');
});
```

Reference seeds in test plans so the generator knows the starting point.

## Best Practices

### For Agents

1. **Use semantic locators**: `getByRole`, `getByLabel`, `getByText` over CSS selectors
2. **Wait for state**: Use `waitForSelector` or `expect().toBeVisible()` before interactions
3. **One assertion per logical check**: Don't combine unrelated assertions
4. **Clear step comments**: Each action should have a comment from the plan

### For Humans

1. **Write clear scenarios**: Agents work better with unambiguous steps
2. **Keep scenarios independent**: Each test should work in isolation
3. **Use descriptive names**: "User can create scenario" not "test1"

## Troubleshooting

### Tests timing out

Increase timeouts in `playwright.config.ts` or add explicit waits:

```typescript
await page.waitForLoadState("networkidle");
```

### Selectors not finding elements

Use the Playwright inspector to find better selectors:

```bash
pnpm test:debug
```

### Auth issues

Delete `.auth/user.json` and run tests again to regenerate auth state.
