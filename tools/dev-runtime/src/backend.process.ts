import type { ApiRuntime } from "@langwatch/platform-api/runtime";
import type { WorkerRuntime } from "@langwatch/worker/runtime";
import { embeddedBackendHost, type BackendEmbeddedHost } from "./backend.host.ts";

/**
 * The two halves of the backend process, taken from each application's own
 * runtime construction entry point rather than restated here.
 *
 * Only `close` is named: starting is each application's own executable's job,
 * and shutdown ordering is the one thing this process owns that neither half
 * can know about.
 */
export type BackendApiHalf = Pick<ApiRuntime<unknown, unknown>, "close">;
export type BackendWorkerHalf = Pick<WorkerRuntime, "close">;

export type BackendHalves = {
  api: BackendApiHalf;
  worker: BackendWorkerHalf;
};

/**
 * Stops the backend process: the worker first, then the API listener.
 *
 * The order is the whole reason this function exists. The worker drains jobs
 * that call back into the API's own in-process graph; closing the listener
 * first would fail those mid-drain, and a job that fails during shutdown looks
 * exactly like a job that failed on its merits. The API is closed even when
 * the worker's drain throws, so a stuck queue cannot leave a listening socket
 * behind.
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
  startApi: (host: BackendEmbeddedHost) => Promise<BackendApiHalf>;
  startWorker: (host: BackendEmbeddedHost) => Promise<BackendWorkerHalf>;
};

/**
 * Boots both applications in one process, worker first.
 *
 * Worker first because the API can enqueue on its very first request, and a
 * stack whose consumers are not yet attached looks healthy while the work
 * piles up. If the API then fails to boot, the worker is drained before the
 * failure is re-thrown — a half-started backend is not a state a caller has to
 * handle.
 *
 * Each half is handed its own {@link embeddedBackendHost}, so neither reaches
 * the real process for signals or exit; installing those is the caller's job,
 * once, over {@link drainBackend}.
 */
export async function startBackend(options: BackendStartOptions): Promise<BackendHalves> {
  const host = embeddedBackendHost({
    env: options.env,
    write: options.write,
    fail: options.fail,
  });
  const worker = await options.startWorker(host);
  try {
    const api = await options.startApi(host);
    return { api, worker };
  } catch (error) {
    await worker.close();
    throw error;
  }
}
