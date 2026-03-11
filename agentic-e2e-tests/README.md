# E2E Tests

End-to-end tests for LangWatch using Playwright.

## Running Locally

The simplest way to run e2e tests is from the repository root:

```bash
make test-e2e        # Full lifecycle: start infra, migrate, build, test, teardown
make test-e2e-up     # Start infrastructure only (postgres, redis, opensearch)
make test-e2e-down   # Stop infrastructure
```

### Manual Setup (for development)

If you want to iterate on tests without rebuilding the app each time:

```bash
# 1. Start infrastructure
make test-e2e-up

# 2. Migrate database (first time or after schema changes)
cd langwatch
DATABASE_URL="postgresql://prisma:prisma@localhost:5433/testdb?schema=testdb" pnpm prisma:migrate

# 3. Start the app (in a separate terminal)
cd langwatch
DATABASE_URL="postgresql://prisma:prisma@localhost:5433/testdb?schema=testdb" \
REDIS_URL="redis://localhost:6380" \
ELASTICSEARCH_NODE_URL="http://localhost:9201" \
IS_OPENSEARCH="true" \
NEXTAUTH_SECRET="test-secret-for-e2e" \
NEXTAUTH_URL="http://localhost:5570" \
SKIP_ENV_VALIDATION="true" \
SKIP_CLICKHOUSE_MIGRATE="true" \
pnpm dev -p 5570

# 4. Run tests (in another terminal)
cd agentic-e2e-tests
pnpm install          # first time only
pnpm exec playwright install --with-deps chromium  # first time only
pnpm test

# 5. Teardown when done
make test-e2e-down
```

## CI

E2E tests run automatically via GitHub Actions (`.github/workflows/e2e-ci.yml`) on:
- Pushes to `main`
- Pull requests that change `langwatch/`, `agentic-e2e-tests/`, or the workflow file
- Manual trigger via `workflow_dispatch`

The CI workflow uses GitHub Actions service containers for postgres, redis, and opensearch. The app is built and started on the runner. Test reports and artifacts are uploaded on failure.

## Test Environment

Tests use isolated ports to avoid conflicts with the dev environment:

| Service    | Dev Port | Test Port |
|------------|----------|-----------|
| App        | 5560     | 5570      |
| PostgreSQL | 5432     | 5433      |
| Redis      | 6379     | 6380      |
| OpenSearch | 9200     | 9201      |

## Architecture

### Authentication

The `auth.setup.ts` project runs before all tests:
1. Registers a test user (`e2e-test@langwatch.ai` / `TestPassword123!`)
2. Signs in through the UI
3. Completes onboarding if shown
4. Saves session state to `.auth/user.json`

Subsequent tests reuse the saved session. Delete `.auth/user.json` to force re-authentication.

### Global Setup

`global-setup.ts` runs before any test project and:
- Validates environment configuration
- Waits for the app to respond (up to 60 seconds with retries)
- Fails with a helpful error if the app is unreachable

### Test Structure

Tests use Gherkin-style step functions for readability:

```typescript
// steps.ts
export async function givenIAmOnTheScenariosListPage(page: Page) { ... }
export async function whenIClickNewScenario(page: Page) { ... }

// scenario-archive.spec.ts
test("archive a single scenario via row action menu", async ({ page }) => {
  await givenIAmOnTheScenariosListPage(page);
  await whenIOpenRowActionMenuFor(page, "My Scenario");
  await whenIClickArchiveInMenu(page);
  await whenIConfirmArchival(page);
  await thenScenarioDoesNotAppearInList(page, "My Scenario");
});
```

### Configuration

- **Workers**: 1 (sequential execution)
- **Browser**: Chromium only
- **Retries**: 2 in CI, 0 locally
- **Traces/screenshots/video**: Retained on failure
- **Timeout**: 60s per test, 15s per action, 30s per navigation

## Writing New Tests

1. Check the feature file in `specs/` for the scenario to implement
2. Add step functions to the relevant `steps.ts` (use Given/When/Then naming)
3. Write the test in the appropriate `.spec.ts` file
4. Add doc comments linking to the feature file

## Troubleshooting

**Auth issues**: Delete `.auth/user.json` and re-run tests.

**Element not found / strict mode violation**: Chakra UI renders duplicate dialog elements. Use `.last()` to target the visible one.

**Tests timing out**: Verify infrastructure is running (`make test-e2e-up`) and app is reachable at `http://localhost:5570`.

**Database issues**: Reset everything with `make test-e2e-down && make test-e2e-up`, then re-run migrations.
