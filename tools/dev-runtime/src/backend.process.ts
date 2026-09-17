import type { ProcessObservability } from "@langwatch/observability/node";
import type { WorkerRuntime } from "@langwatch/worker/runtime";
import { embeddedBackendHost, type BackendEmbeddedHost } from "./backend.host.ts";

/**
 * The two halves of the backend process, taken from each application's own
 * boot entry point. The worker half also carries the observability graph it
 * built first, which this process hands to the API instead of duplicating.
 */
export type BackendApiHalf = { close(): Promise<void> };
export type BackendWorkerHalf = Pick<WorkerRuntime, "close"> & {
  readonly observability: ProcessObservability;
};

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

/** What each hosted application is booted with, injectable for tests. */
export type BackendStartOptions = {
  env: Readonly<Record<string, unknown>>;
  write: (line: string) => void;
  fail: (code: number) => void;
  startApi: (
    host: BackendEmbeddedHost,
    observability: ProcessObservability,
  ) => Promise<BackendApiHalf>;
  startWorker: (host: BackendEmbeddedHost) => Promise<BackendWorkerHalf>;
};

/**
 * Start the worker first so the API never accepts work without a consumer.
 * If API boot fails, drain the half-started worker before rethrowing.
 */
export async function startBackend(options: BackendStartOptions): Promise<BackendHalves> {
  const host = embeddedBackendHost({
    env: options.env,
    write: options.write,
    fail: options.fail,
  });
  const worker = await options.startWorker(host);
  try {
    // The SDK's tracer provider can be set up only once per process, so the
    // API reuses the worker's already-built graph instead of its own.
    const api = await options.startApi(host, worker.observability);
    return { api, worker };
  } catch (error) {
    await worker.close();
    throw error;
  }
}
