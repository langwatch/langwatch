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

      // Any HTTP response proves something is listening and serving. We don't
      // require a specific status because the headless tiers can target the
      // API server directly, where `/` is a legitimate 404 — the SPA isn't
      // running. The publicEnv check below is the real readiness gate.
      if (response.status > 0) {
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

/**
 * Refuses to run against an app configured for a different origin.
 *
 * This suite creates real organisations, projects and traces. It must point at
 * a disposable database, and the app's own `BASE_HOST` is the most reliable
 * signal available over HTTP of *which* instance answered: a dedicated e2e
 * instance reports the URL it was started on, while a shared dev instance
 * reports the developer's own.
 *
 * This check exists because its absence cost us: a run against a directly
 * addressed API server silently used the dev database — `server.mts` loads
 * `.env` with `override: true`, so the exported `DATABASE_URL` was ignored —
 * and wrote test tenants into it. Nothing failed; the tests passed. The fix is
 * to override via `langwatch/.env.portless`, which is loaded last and wins.
 *
 * A mismatch is also what breaks sign-in: `/api/auth/*` rejects state-changing
 * requests whose `Origin` doesn't match `BASE_HOST` with 403 INVALID_ORIGIN.
 */
async function verifyDedicatedInstance(): Promise<void> {
  if (process.env.E2E_ALLOW_ORIGIN_MISMATCH === "1") {
    console.log(
      "\n⚠️  E2E_ALLOW_ORIGIN_MISMATCH=1 — skipping the dedicated-instance check.\n" +
        "   The suite will create real data wherever this app points.",
    );
    return;
  }

  const url =
    `${BASE_URL}/api/trpc/publicEnv?batch=1` +
    `&input=${encodeURIComponent('{"0":{"json":{}}}')}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = (await response.json()) as Array<{
    result?: { data?: { json?: { BASE_HOST?: string } } };
  }>;
  const baseHost = body?.[0]?.result?.data?.json?.BASE_HOST;

  if (!baseHost) {
    throw new Error("Could not read BASE_HOST from publicEnv.");
  }

  const reported = new URL(baseHost).origin;
  const target = new URL(BASE_URL).origin;

  if (reported !== target) {
    throw new Error(
      `\n❌ The app at ${target} reports BASE_HOST ${reported}.\n\n` +
        `Those must match. A mismatch means this is very likely a shared dev\n` +
        `instance reached on another port — and this suite writes real rows,\n` +
        `so running it here would pollute that instance's database. Sign-in\n` +
        `would also fail: /api/auth/* rejects requests whose Origin doesn't\n` +
        `match BASE_HOST.\n\n` +
        `Start a dedicated instance, and override its databases in\n` +
        `langwatch/.env.portless — exported shell variables do NOT work,\n` +
        `because server.mts loads .env with override:true. Set at least:\n` +
        `  DATABASE_URL=...        (a disposable database)\n` +
        `  CLICKHOUSE_URL=...      (a disposable database)\n` +
        `  BASE_HOST=${target}\n` +
        `  NEXTAUTH_URL=${target}\n\n` +
        `To override anyway, set E2E_ALLOW_ORIGIN_MISMATCH=1.\n`,
    );
  }

  console.log(`✅ Dedicated instance confirmed (BASE_HOST ${reported})`);
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
  await verifyDedicatedInstance();

  console.log("\n" + "=".repeat(60));
  console.log("Global setup complete, starting tests...");
  console.log("=".repeat(60) + "\n");
}
