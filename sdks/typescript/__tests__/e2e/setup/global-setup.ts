import * as net from "node:net";
import { URL } from "node:url";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

const DEFAULT_ENDPOINT = "http://localhost:5560";
const DEFAULT_DATABASE_URL = "postgres://prisma:prisma@localhost:5432/mydb?schema=mydb";

dotenv.config({
  path: resolve(__dirname, "../../../.env.test"),
  override: true,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a TCP port until it accepts connections.
 *
 * Each attempt has a 5-second socket timeout; on failure we wait 1 second
 * before retrying. The overall deadline defaults to 30 seconds so the CI
 * server has time to finish starting up.
 *
 * IMPORTANT: these helpers must not throw during normal startup delays.
 * In vitest 3.2.4, a throwing globalSetup produces the misleading
 * "No test files found" message instead of the real error.
 */
const waitForTcp = async (host: string, port: number, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host, port });
        const cleanup = () => {
          socket.removeAllListeners();
          socket.destroy();
        };
        socket.on("connect", () => { cleanup(); resolve(); });
        socket.on("error", (err) => { cleanup(); reject(err); });
        socket.setTimeout(5_000, () => { cleanup(); reject(new Error("timeout")); });
      });
      return;
    } catch {
      await sleep(1_000);
    }
  }
  throw new Error(`Timeout waiting for TCP ${host}:${port} after ${timeoutMs}ms`);
};

/**
 * Poll an HTTP endpoint until it returns a 2xx response.
 *
 * Each attempt has a 5-second fetch timeout; on failure (connection
 * refused, non-2xx, timeout) we wait 2 seconds before retrying.
 * The overall deadline defaults to 30 seconds.
 *
 * See waitForTcp for why these retries matter.
 */
const waitForHttp = async (url: string, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) return;
      } finally {
        clearTimeout(id);
      }
    } catch {
      // Connection refused, aborted, or non-2xx — retry after a short delay.
    }
    await sleep(2_000);
  }
  throw new Error(`Timeout waiting for HTTP ${url} after ${timeoutMs}ms`);
};

const ensureEnv = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`${key} is required for e2e tests`);
  }
  process.env[key] = value;
  return value;
};

const main = async () => {
  const endpoint = ensureEnv("LANGWATCH_ENDPOINT", DEFAULT_ENDPOINT);
  ensureEnv("LANGWATCH_API_KEY");

  console.log("Waiting for endpoint to be reachable:", endpoint);
  await waitForHttp(endpoint.replace(/\/$/, ""));

  const dbUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  console.log(`Waiting for database at ${dbUrl.hostname}:${dbUrl.port || 5432}...`);
  await waitForTcp(dbUrl.hostname, Number(dbUrl.port) || 5432);

  console.log("All services reachable, starting tests.");
};

/**
 * Vitest globalSetup entry point — awaited before any test files run.
 *
 * Verifies that the LangWatch server and database are accepting
 * connections so tests don't fail with cryptic network errors.
 */
export default async function setup(): Promise<void> {
  await main();
}
