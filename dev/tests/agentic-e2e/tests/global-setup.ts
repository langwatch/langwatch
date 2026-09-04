/**
 * Global Setup for E2E Tests
 *
 * Boots what the suite needs and validates it is ready before any test runs.
 *
 * A stack that already answers at BASE_URL is used as it stands — that is CI,
 * which boots its own, and a developer who left `pnpm dev` running. Otherwise
 * the shared helper starts one on `E2E_STACK_PORT` and this file puts it back
 * down afterwards.
 *
 * The journey's target agent starts here too: a run has to complete, so the
 * address the HTTP agent names must answer.
 */
import { startStack, type RunningStack } from "@langwatch/e2e-stack";

import { startEchoAgent, type EchoAgent } from "./journey/echo-agent";
import { JOURNEY_MODEL_ID } from "./journey/journey.constants";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const STACK_PORT = Number(process.env.E2E_STACK_PORT ?? "5600");
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;

async function alreadyServing(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    return response.ok || response.status === 302;
  } catch {
    return false;
  }
}

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

  let stack: RunningStack | null = null;
  if (await alreadyServing(BASE_URL)) {
    console.log(`\n✅ Using the stack already serving at ${BASE_URL}`);
  } else {
    console.log(`\n🚀 No stack at ${BASE_URL}; starting one on port ${STACK_PORT}...`);
    stack = await startStack({
      port: STACK_PORT,
      env: { LANGWATCH_DEFAULT_MODEL: JOURNEY_MODEL_ID },
    });
  }

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
    await stack?.stop();
  };
}
