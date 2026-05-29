/**
 * Global Setup for E2E Tests
 *
 * Runs before all tests to validate the environment is ready.
 * Fails fast with helpful error messages if prerequisites are missing.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;

async function waitForApp(): Promise<void> {
  console.log(`\n🔍 Checking app availability at ${BASE_URL}...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(BASE_URL, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok || response.status === 302) {
        console.log(`✅ App is ready (status: ${response.status})`);
        return;
      }

      console.log(
        `⏳ Attempt ${attempt}/${MAX_RETRIES}: Got status ${response.status}, retrying...`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `⏳ Attempt ${attempt}/${MAX_RETRIES}: ${message}, retrying...`
      );
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  throw new Error(
    `\n❌ App not available at ${BASE_URL} after ${MAX_RETRIES} attempts.\n\n` +
      `Make sure the app is running:\n` +
      `  1. cd langwatch\n` +
      `  2. PORT=5570 pnpm dev\n\n` +
      `Or check if infrastructure is running:\n` +
      `  docker compose -f compose.test.yml ps\n`
  );
}

// A 200 from vite's `/` only proves the dev server's shell is up; the API
// (proxied, on-demand compiled in dev) can still be cold. The signin page
// renders blank until the public `publicEnv` tRPC query resolves, so tests
// race a not-yet-ready backend. Wait for that exact endpoint to serve 200.
async function waitForApi(): Promise<void> {
  const url =
    `${BASE_URL}/api/trpc/publicEnv?batch=1` +
    `&input=${encodeURIComponent('{"0":{"json":{}}}')}`;
  console.log(`\n🔍 Checking API readiness at ${url}...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        console.log(`✅ API is ready (status: ${response.status})`);
        return;
      }
      console.log(
        `⏳ Attempt ${attempt}/${MAX_RETRIES}: API status ${response.status}, retrying...`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`⏳ Attempt ${attempt}/${MAX_RETRIES}: ${message}, retrying...`);
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  throw new Error(
    `\n❌ API not ready at ${url} after ${MAX_RETRIES} attempts.\n` +
      `The app shell loaded but the backend never served publicEnv.\n`
  );
}

function validateEnvironment(): void {
  console.log("\n🔍 Validating environment configuration...");

  const warnings: string[] = [];

  // These env vars are used by the langwatch app, not the test runner
  // But we can check that they look reasonable if set
  const appEnvVars = [
    "DATABASE_URL",
    "REDIS_URL",
    "NEXTAUTH_SECRET",
  ];

  // In CI, these should be set by the workflow
  // Locally, the .env file should have them
  if (process.env.CI) {
    console.log("  Running in CI environment");
  } else {
    console.log("  Running locally");

    // Check if common test ports are being used (indicates test env)
    const dbUrl = process.env.DATABASE_URL ?? "";
    const redisUrl = process.env.REDIS_URL ?? "";

    if (dbUrl.includes(":5432") && !dbUrl.includes(":5433")) {
      warnings.push(
        "DATABASE_URL uses default port 5432 - consider using test port 5433 to avoid conflicts"
      );
    }
    if (redisUrl.includes(":6379") && !redisUrl.includes(":6380")) {
      warnings.push(
        "REDIS_URL uses default port 6379 - consider using test port 6380 to avoid conflicts"
      );
    }
  }

  if (warnings.length > 0) {
    console.log("\n⚠️  Warnings:");
    warnings.forEach((w) => console.log(`   - ${w}`));
  }

  console.log("✅ Environment configuration looks good\n");
}

export default async function globalSetup(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("E2E Test Global Setup");
  console.log("=".repeat(60));

  validateEnvironment();
  await waitForApp();
  await waitForApi();

  console.log("\n" + "=".repeat(60));
  console.log("Global setup complete, starting tests...");
  console.log("=".repeat(60) + "\n");
}
