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

const waitForTcp = (host: string, port: number, timeoutMs = 5_000) =>
  new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port });
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error(`Timeout waiting for TCP ${host}:${port}`));
    };
    const cleanup = () => {
      socket.off("error", onError);
      socket.off("connect", onReady);
      socket.setTimeout(0);
      socket.destroy();
    };
    socket.on("error", onError);
    socket.on("connect", onReady);
    socket.setTimeout(timeoutMs, onTimeout);
  });

const waitForHttp = async (url: string, timeoutMs = 5_000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(id);
  }
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
  await waitForTcp(dbUrl.hostname, Number(dbUrl.port) || 5432);
};

main().catch((err) => {
  console.error("[e2e global-setup] failed:", err);
  process.exit(1);
});
