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
      // retry
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
  // Ensure endpoint and API key
  const endpoint = ensureEnv("LANGWATCH_ENDPOINT", DEFAULT_ENDPOINT);
  ensureEnv("LANGWATCH_API_KEY");

  // Ensure services are reachable
  console.log("Waiting for endpoint to be reachable:", endpoint);
  await waitForHttp(endpoint.replace(/\/$/, ""));

  const dbUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  console.log(`Waiting for database at ${dbUrl.hostname}:${dbUrl.port || 5432}...`);
  await waitForTcp(dbUrl.hostname, Number(dbUrl.port) || 5432);

  console.log("All services reachable, starting tests.");
};

/**
 * Vitest globalSetup entry point.
 * This function is awaited before any tests run.
 */
export default async function setup(): Promise<void> {
  await main();
}
