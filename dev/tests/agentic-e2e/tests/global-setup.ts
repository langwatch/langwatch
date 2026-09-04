/**
 * Global Setup for E2E Tests
 *
 * Resolves the stack the suite runs against and validates it before any test.
 * The helper decides which one: `LANGWATCH_E2E_BASE_URL` (CI), else this
 * worktree's haven stack, else one already answering at BASE_URL, else it boots
 * one on `E2E_STACK_PORT` and this file puts that back down afterwards.
 *
 * The journey's target agent starts here too: a run has to complete, so the
 * address the HTTP agent names must answer.
 */
import { startStack, type RunningStack } from "@langwatch/e2e-stack";

import { startEchoAgent, type EchoAgent } from "./journey/echo-agent";
import { JOURNEY_MODEL_ID } from "./journey/journey.constants";

let BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const STACK_PORT = Number(process.env.E2E_STACK_PORT ?? "5600");
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
        `⏳ Attempt ${attempt}/${MAX_RETRIES}: Got status ${response.status}, retrying...`,
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
    `\n❌ App not available at ${BASE_URL} after ${MAX_RETRIES} attempts.\n\n` +
      `Run the suite from the repository root with \`pnpm test:e2e\`, which boots\n` +
      `the stack itself, or start one yourself with \`PORT=5600 pnpm dev\`.\n`,
  );
}

// A 200 from vite's `/` only proves the dev server's shell is up; the API
// (proxied, on-demand compiled in dev) can still be cold. The signin page
// renders blank until the public `publicEnv` tRPC query resolves, so tests
// race a not-yet-ready backend. Wait for that exact endpoint to serve 200.
async function waitForApi(): Promise<void> {
  const url =
    `${BASE_URL}/api/trpc/publicEnv?batch=1` + `&input=${encodeURIComponent('{"0":{"json":{}}}')}`;
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
        `⏳ Attempt ${attempt}/${MAX_RETRIES}: API status ${response.status}, retrying...`,
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
      `The app shell loaded but the backend never served publicEnv.\n`,
  );
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  console.log("\n" + "=".repeat(60));
  console.log("E2E Test Global Setup");
  console.log("=".repeat(60));

  const stack: RunningStack = await startStack({
    port: STACK_PORT,
    baseUrlHint: BASE_URL,
    env: { LANGWATCH_DEFAULT_MODEL: JOURNEY_MODEL_ID },
  });
  console.log(`\n✅ Stack (${stack.source}): ${stack.baseUrl}`);

  // Every worker reads this, and the journey builds its browser context on it.
  BASE_URL = stack.baseUrl;
  process.env.BASE_URL = stack.baseUrl;

  await waitForApp();
  await waitForApi();

  const echo: EchoAgent = await startEchoAgent();
  process.env.E2E_ECHO_AGENT_URL = echo.url;
  console.log(`✅ Echo agent listening at ${echo.url}`);

  console.log("\n" + "=".repeat(60));
  console.log("Global setup complete, starting tests...");
  console.log("=".repeat(60) + "\n");

  return async () => {
    await echo.stop();
    await stack.stop();
  };
}
