# Agentic E2E Tests

End-to-end tests for LangWatch using Playwright, designed to be authored and maintained with AI assistance.

## Quick Start

```bash
# 1. Start infrastructure services (from this directory)
cd agentic-e2e-tests
docker compose up -d

# 2. Run database migrations (first time only)
cd ../langwatch
pnpm prisma:migrate

# 3. Start the app (in langwatch/ directory)
PORT=5570 pnpm dev

# 4. Run tests (from agentic-e2e-tests/ directory)
cd ../agentic-e2e-tests
pnpm install   # First time only
pnpm test
```

## Architecture

### Test Environment

Tests run against a **locally-running Next.js dev server** with Docker providing infrastructure:

| Service | Dev Port | Test Port | Notes |
|---------|----------|-----------|-------|
| Next.js App | 5560 | 5570 | Runs on host, not in Docker |
| PostgreSQL | 5432 | 5433 | Docker |
| Redis | 6379 | 6380 | Docker |
| OpenSearch | 9200 | 9201 | Docker |
| NLP Service | 5561 | 5563 | Docker |

**Why local app instead of Docker?**
- Faster iteration during test development
- Avoids Docker build memory issues
- Tests run against current source code (not a built image)
- Easier debugging with hot reload

### Directory Structure

```text
agentic-e2e-tests/
├── tests/
│   └── scenarios/
│       ├── steps.ts              # Gherkin-style step definitions
│       ├── scenario-editor.spec.ts
│       ├── scenario-library.spec.ts
│       └── scenario-execution.spec.ts
├── .auth/                        # Auth state (gitignored)
├── playwright-report/            # HTML test reports
└── test-results/                 # Artifacts from failed tests
```

## Test Design

### Feature File Mapping

Tests map directly to Gherkin scenarios in `specs/`:

```text
specs/scenarios/scenario-editor.feature  →  tests/scenarios/scenario-editor.spec.ts
specs/scenarios/scenario-library.feature →  tests/scenarios/scenario-library.spec.ts
```

Each test has doc comments linking to the source feature file:

```typescript
/**
 * Scenario: Navigate to create form
 * Source: scenario-editor.feature lines 14-18
 */
test("navigate to create form", async ({ page }) => {
  // ...
});
```

### Step-Based Architecture

Tests use **Gherkin-style step functions** from `steps.ts`:

```typescript
// steps.ts - Named to match feature file language
export async function givenIAmOnTheScenariosListPage(page: Page) { ... }
export async function whenIClickNewScenario(page: Page) { ... }
export async function thenISeeTheScenarioEditor(page: Page) { ... }

// scenario-editor.spec.ts - Reads like the feature file
test("navigate to create form", async ({ page }) => {
  await givenIAmOnTheScenariosListPage(page);
  await whenIClickNewScenario(page);
  await thenISeeTheScenarioEditor(page);
});
```

**Benefits:**
- **Traceability** - Clear mapping from tests to specs
- **Readability** - Tests read like Gherkin (Given/When/Then)
- **Reusability** - Steps compose into different tests
- **Maintainability** - Change selectors in one place

### Workflow Tests

For scenarios that would require seeded data, we use **workflow tests** that combine multiple feature scenarios into one self-contained test:

```typescript
/**
 * Workflow test covering:
 * - scenario-editor.feature: "Save new scenario"
 * - scenario-library.feature: "Click scenario row to edit"
 * - scenario-editor.feature: "Load existing scenario for editing"
 * - scenario-editor.feature: "Update scenario name"
 */
test("scenario lifecycle: create, view in list, edit, and verify", async ({ page }) => {
  // Create scenario
  await givenIAmOnTheScenariosListPage(page);
  await whenIClickNewScenario(page);
  await whenIFillInNameWith(page, "Refund Request Test");
  await whenIClickSave(page);

  // Verify in list
  await thenScenarioAppearsInList(page, "Refund Request Test");

  // Edit scenario
  await whenIClickOnScenarioInList(page, "Refund Request Test");
  await whenIChangeNameTo(page, "Refund Request (Updated)");
  await whenIClickSave(page);

  // Verify update
  await thenScenarioAppearsInList(page, "Refund Request (Updated)");
});
```

**Why workflow tests instead of seeded data?**
- No API exists for creating scenarios programmatically
- Single test is self-contained and can run independently
- Tests a real user journey end-to-end
- Avoids test interdependencies (Test A creates data for Test B)

### Handling Chakra UI Duplicate Dialogs

Chakra UI renders duplicate dialog elements (mobile/desktop). Steps use `.last()` to target the topmost visible dialog:

```typescript
// Target the visible dialog's elements
await page.getByRole("textbox", { name: "Name" }).last().fill("...");
await page.getByRole("button", { name: /save and run/i }).last().click();
```

## Authentication

Tests are **self-contained** - they create their own test user automatically. No environment variables or secrets are required.

The `auth.setup.ts` handles this:
1. Registers a test user via the `/api/trpc/user.register` API
2. Signs in through the UI
3. Completes onboarding if shown
4. Saves session state to `.auth/user.json`
5. Subsequent runs reuse the saved auth state

To reset authentication, delete `.auth/user.json` and re-run tests.

## Running Tests

```bash
# Run all tests (from agentic-e2e-tests/ directory)
pnpm test

# Run specific test file
pnpm exec playwright test tests/scenarios/scenario-editor.spec.ts

# Run with UI mode (interactive)
pnpm test:ui

# Debug a specific test
pnpm exec playwright test --debug

# View last test report
pnpm exec playwright show-report playwright-report
```

## CI Integration

E2E tests are configured to run in CI with:
- Infrastructure services via GitHub Actions service containers
- Chromium + Firefox browsers
- Retries on failure (2 retries in CI)
- Global setup that validates environment and waits for app readiness

See `.github/workflows/langwatch-app-ci.yml` for the full configuration.

The CI workflow installs dependencies for both `langwatch/` and `agentic-e2e-tests/` and runs tests using `pnpm test` from the e2e directory.

**Global Setup (`global-setup.ts`):**
- Validates environment configuration
- Waits for the app to be ready (up to 60 seconds)
- Fails fast with helpful error messages if something is wrong

## Troubleshooting

### Auth issues / session expired
Delete `.auth/user.json` and re-run tests. The auth setup will create a fresh session.

### Element not found / strict mode violation
Chakra renders duplicate elements. Use `.first()` or `.last()`:
```typescript
await page.getByRole("button", { name: "Save" }).last().click();
```

### Tests timing out
1. Ensure infrastructure is running: `docker compose ps`
2. Ensure app is running on port 5570: `curl http://localhost:5570`
3. Check for console errors in the browser

### Database issues
Reset the test database:
```bash
docker compose down -v
docker compose up -d
cd ../langwatch && pnpm prisma:migrate
```

## For AI Agents

### Adding New Tests

1. Check the feature file in `specs/` for the scenario to implement
2. Add step functions to `steps.ts` if needed (use Gherkin naming)
3. Write the test in the appropriate `.spec.ts` file
4. Add doc comments linking to the feature file

### Fixing Failing Tests

1. Check `test-results/*/error-context.md` for page snapshot
2. Look for duplicate elements (use `.first()` or `.last()`)
3. Verify selectors match the current UI
4. Run with `--debug` to step through interactively

### Test Coverage Status

| Feature | Tests | Status |
|---------|-------|--------|
| Scenario Editor - Navigate | ✅ | Passing |
| Scenario Editor - Form fields | ✅ | Passing |
| Scenario Editor - Create/Edit lifecycle | ✅ | Passing (workflow) |
| Scenario Editor - Add criterion | ✅ | Passing |
| Scenario Library - Navigation | ✅ | Passing |
| Scenario Library - Empty state | ✅ | Passing |
| Scenario Execution - Page loads | ✅ | Passing |
