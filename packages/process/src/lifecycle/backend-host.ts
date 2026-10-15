import process from "node:process";

import { installBootGuard, processFailureLine } from "@langwatch/observability";

import { GracefulShutdown } from "./graceful-shutdown.ts";

/**
 * The api and the worker hosted in one Node process (ADR-168). Each half is its own app's
 * start seam, passed in, so the framework never imports an application. Neither owns the process.
 */
export type BackendApiHalf = { close(): Promise<void> };
export type BackendWorkerHalf = { close(): Promise<void> };

export type BackendHalves = {
  api: BackendApiHalf;
  worker: BackendWorkerHalf;
};

/**
 * Drain the worker first because jobs call into the API graph during shutdown.
 * The `finally` prevents a worker failure from leaving the API listener open.
 */
export async function drainBackend({ api, worker }: BackendHalves): Promise<void> {
  try {
    await worker.close();
  } finally {
    await api.close();
  }
}

/** The record that says both halves are serving; `haven reload` and the npx log wait for it. */
export const BACKEND_READY_MSG = "backend ready";

/** The service name the host's own records carry. */
export const BACKEND_SERVICE = "langwatch-backend";

/** Which half a boot failure came from, so its fatal record names it, not the host. */
export type BackendHalfName = "api" | "worker";

/** The service name each half's own records carry. */
export const BACKEND_HALF_SERVICE: Readonly<Record<BackendHalfName, string>> = Object.freeze({
  api: "langwatch-api",
  worker: "langwatch-worker",
});

const BACKEND_HALF = Symbol.for("langwatch.backend.half");

/** The half whose boot threw this, when the host tagged it. */
export function backendHalfOf(error: unknown): BackendHalfName | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const half: unknown = Object.getOwnPropertyDescriptor(error, BACKEND_HALF)?.value;
  return half === "api" || half === "worker" ? half : undefined;
}

/**
 * Tag the half onto the error it threw and rethrow it unchanged: both halves share one
 * process, so without this every failure reads as the host's and the half that refused is lost.
 */
export async function bootHalf<T>(half: BackendHalfName, start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      Object.defineProperty(error, BACKEND_HALF, { value: half, configurable: true });
    }
    throw error;
  }
}

/** How a hosted half is booted: never owning the process the host drains. */
export type BackendHalfOptions = Readonly<{
  ownsProcess: false;
  ownsTelemetry: boolean;
}>;

/** A boot's outcome: the api always serves; a worker that refused boot is named, not thrown. */
export type BootedBackend = Readonly<{ halves: BackendHalves; workerFailure?: unknown }>;

/** Stands in for a worker that refused boot, so draining the halves stays one call. */
export const IDLE_WORKER: BackendWorkerHalf = { close: async () => {} };

/** What each hosted application is booted with, injectable for tests. */
export type BackendStartOptions = {
  startApi: (options: BackendHalfOptions & { port?: number }) => Promise<BackendApiHalf>;
  startWorker: (options: BackendHalfOptions) => Promise<BackendWorkerHalf>;
};

/**
 * Start both halves together: the api answers at once while the worker runs the upgrade, and a
 * queue with no consumer yet is fine (Alex, 2026-10-09, API-UP-DURING-UPGRADE). A refused api
 * drains the worker and throws; a refused worker is answered, and the caller decides its fate.
 */
export async function startBackend(options: BackendStartOptions): Promise<BootedBackend> {
  // One graph per process: the worker sets the telemetry SDK up and the API joins it.
  const [worker, api] = await Promise.allSettled([
    bootHalf("worker", () => options.startWorker({ ownsProcess: false, ownsTelemetry: true })),
    bootHalf("api", () => options.startApi({ ownsProcess: false, ownsTelemetry: false })),
  ]);
  if (api.status === "rejected") {
    if (worker.status === "fulfilled") await worker.value.close();
    throw api.reason;
  }
  if (worker.status === "rejected") {
    return { halves: { api: api.value, worker: IDLE_WORKER }, workerFailure: worker.reason };
  }
  return { halves: { api: api.value, worker: worker.value } };
}

/** The whole drain's ceiling; past it the process exits 1 rather than hang. */
export const BACKEND_SHUTDOWN_DEADLINE_MS = 20_000;

/**
 * Own the process for both halves: boot guard, SIGTERM/SIGINT drain under one deadline, the
 * ready record. Nothing here retries, so a worker that refuses boot is fatal; the dev host keeps
 * its worker optional by calling `startBackend` and retrying itself.
 */
export async function runBackend(options: BackendStartOptions): Promise<void> {
  let halves: BackendHalves | undefined;
  let stopping: Promise<never> | undefined;
  const fail = (event: string, error?: unknown, service = BACKEND_SERVICE): void =>
    void process.stderr.write(processFailureLine({ service, event, error }));
  const shutdown = GracefulShutdown.create({
    logger: {
      info: () => {},
      error: (fields, msg) => fail(msg, "error" in fields ? fields.error : undefined),
    },
    deadlineMs: BACKEND_SHUTDOWN_DEADLINE_MS,
  }).phase({
    name: "backend",
    run: () => (halves ? drainBackend(halves) : undefined),
    timeoutMs: BACKEND_SHUTDOWN_DEADLINE_MS,
  });
  const stop = (code: number): Promise<never> =>
    (stopping ??= shutdown.run().then((error) => process.exit(error === undefined ? code : 1)));

  installBootGuard(BACKEND_SERVICE, { onFatal: () => void stop(1) });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void stop(0));

  let booted: BootedBackend;
  try {
    booted = await startBackend(options);
  } catch (error) {
    const half = backendHalfOf(error);
    fail("fatal boot failure", error, half ? BACKEND_HALF_SERVICE[half] : undefined);
    process.exit(1);
  }
  halves = booted.halves;
  if (booted.workerFailure !== undefined) {
    fail("worker failed to boot", booted.workerFailure, BACKEND_HALF_SERVICE.worker);
    await stop(1);
  }
  process.stdout.write(`${JSON.stringify({ level: "info", msg: BACKEND_READY_MSG })}\n`);
}
