/**
 * The two halves of the backend process, each as its own app's start seam
 * answered: a server this launcher drains. Neither owns the process.
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

/** Which half a boot failure came from, so its fatal record names it, not the launcher. */
export type BackendHalfName = "api" | "worker";

/** The service name each half's own records carry. */
export const BACKEND_HALF_SERVICE: Readonly<Record<BackendHalfName, string>> = Object.freeze({
  api: "langwatch-api",
  worker: "langwatch-worker",
});

const BACKEND_HALF = Symbol.for("langwatch.backend.half");

/** The half whose boot threw this, when the launcher tagged it. */
export function backendHalfOf(error: unknown): BackendHalfName | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const half = (error as Record<symbol, unknown>)[BACKEND_HALF];
  return half === "api" || half === "worker" ? half : undefined;
}

/**
 * Tag the half onto the error it threw and rethrow it unchanged: the launcher
 * hosts both halves in one process, so without this every failure reads as the
 * launcher's and the half that actually refused is lost.
 */
async function bootHalf<T>(half: BackendHalfName, start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      Object.defineProperty(error, BACKEND_HALF, { value: half, configurable: true });
    }
    throw error;
  }
}

/** How a hosted half is booted: never owning the process the launcher drains. */
export type BackendHalfOptions = Readonly<{
  ownsProcess: false;
  ownsTelemetry: boolean;
}>;

/** What each hosted application is booted with, injectable for tests. */
export type BackendStartOptions = {
  startApi: (options: BackendHalfOptions) => Promise<BackendApiHalf>;
  startWorker: (options: BackendHalfOptions) => Promise<BackendWorkerHalf>;
};

/**
 * Start the worker first so the API never accepts work without a consumer.
 * If API boot fails, drain the half-started worker before rethrowing.
 */
export async function startBackend(options: BackendStartOptions): Promise<BackendHalves> {
  // One graph per process: the worker sets the telemetry SDK up and the API
  // joins it. A second setup is what prints "OpenTelemetry is already set up".
  const worker = await bootHalf("worker", () =>
    options.startWorker({ ownsProcess: false, ownsTelemetry: true }),
  );
  try {
    const api = await bootHalf("api", () =>
      options.startApi({ ownsProcess: false, ownsTelemetry: false }),
    );
    return { api, worker };
  } catch (error) {
    await worker.close();
    throw error;
  }
}
