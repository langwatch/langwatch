/**
 * One holder per ClickHouse server across test processes: the app reader is one user per server
 * and its upgrade DDL replaces it, so a file provisioning there would break another's reads. The
 * hold is a loopback port derived from the server, freed by the kernel when its process ends.
 */
import { createHash, randomUUID } from "node:crypto";
import { connect, createServer, type Server } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const PORT_BASE = 41_000;
const PORT_SPAN = 2_000;
const POLL_MS = 200;
const BANNER_TIMEOUT_MS = 2_000;

/** This module instance: a hold another instance left in this worker is a finished file's. */
const INSTANCE = randomUUID();

interface WorkerHold {
  instance: string;
  server: Server;
}

/** The holds this worker owns, across module instances: vitest re-imports this per test file. */
const WORKER_HOLDS_KEY = Symbol.for("langwatch.test-harness.clickhouse-server-holds");
const globalHolds = globalThis as { [WORKER_HOLDS_KEY]?: Map<string, WorkerHold> };
const workerHolds = (globalHolds[WORKER_HOLDS_KEY] ??= new Map<string, WorkerHold>());

/** Waiters in this instance, one after another per server. */
const queues = new Map<string, Promise<void>>();

function bannerOf({ key }: { key: string }): string {
  return `langwatch-test-clickhouse-hold ${key}\n`;
}

function portOf({ key }: { key: string }): number {
  return PORT_BASE + (createHash("sha256").update(key).digest().readUInt32BE(0) % PORT_SPAN);
}

function listen({ key }: { key: string }): Promise<Server | undefined> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.end(bannerOf({ key })));
    server.once("error", (error: NodeJS.ErrnoException) =>
      error.code === "EADDRINUSE" ? resolve(undefined) : reject(error),
    );
    server.listen({ host: "127.0.0.1", port: portOf({ key }), exclusive: true }, () => {
      server.unref();
      resolve(server);
    });
  });
}

/** What holds the port: another test file's hold, nobody any more, or something else. */
function holderOf({ key }: { key: string }): Promise<"test-hold" | "free" | "foreign"> {
  return new Promise((resolve) => {
    let received = "";
    const socket = connect({ host: "127.0.0.1", port: portOf({ key }) });
    socket.setTimeout(BANNER_TIMEOUT_MS, () => {
      socket.destroy();
      resolve("foreign");
    });
    socket.on("data", (chunk) => (received += chunk.toString()));
    socket.on("error", () => resolve("free"));
    socket.on("close", () =>
      resolve(received.startsWith("langwatch-test-clickhouse-hold ") ? "test-hold" : "foreign"),
    );
  });
}

async function acquire({ key }: { key: string }): Promise<Server> {
  const left = workerHolds.get(key);
  if (left && left.instance !== INSTANCE) {
    workerHolds.delete(key);
    await new Promise((resolve) => left.server.close(resolve));
  }
  for (;;) {
    const server = await listen({ key });
    if (server) return server;
    if ((await holderOf({ key })) === "foreign") {
      throw new Error(
        `Port ${portOf({ key })} holds no ClickHouse test hold for ${key}; free it to run the suite`,
      );
    }
    await sleep(POLL_MS);
  }
}

/**
 * Waits until no other test file holds `url`'s server, then holds it until the returned release
 * runs or the process ends. Keyed by host and port: the reader's names are server-wide.
 */
export async function holdTestClickHouseServer({
  url,
}: {
  url: string;
}): Promise<() => Promise<void>> {
  const key = new URL(url).host;
  const previous = queues.get(key) ?? Promise.resolve();
  let freeNext!: () => void;
  const turn = new Promise<void>((resolve) => (freeNext = resolve));
  queues.set(
    key,
    previous.then(() => turn),
  );
  await previous;
  let server: Server;
  try {
    server = await acquire({ key });
  } catch (error) {
    freeNext();
    throw error;
  }
  workerHolds.set(key, { instance: INSTANCE, server });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (workerHolds.get(key)?.server === server) workerHolds.delete(key);
    await new Promise((resolve) => server.close(resolve));
    freeNext();
  };
}
