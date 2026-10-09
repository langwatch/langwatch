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

/** The record that says both halves are serving; the dev script's ready pattern names it. */
export const BACKEND_READY_MSG = "backend ready";

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

/** A process listener, as `EventEmitter.listeners` hands it back. */
type Listener = ReturnType<NodeJS.EventEmitter["listeners"]>[number];
type ListenerHost = {
  eventNames(): (string | symbol)[];
  listeners(event: string | symbol): Listener[];
  off(event: string | symbol, listener: Listener): unknown;
};
export type ListenerSnapshot = ReadonlyMap<string | symbol, ReadonlySet<Listener>>;
export type AddedListener = readonly [event: string | symbol, listener: Listener];

/** The listeners attached right now, per event: taken just before a generation boots. */
export function snapshotListeners(emitter: ListenerHost): ListenerSnapshot {
  return new Map(emitter.eventNames().map((event) => [event, new Set(emitter.listeners(event))]));
}

/** What was attached after `before`: a generation's own listeners, taken before the next link. */
export function listenersAddedSince({
  emitter,
  before,
}: {
  emitter: ListenerHost;
  before: ListenerSnapshot;
}): AddedListener[] {
  return emitter.eventNames().flatMap((event) =>
    emitter
      .listeners(event)
      .filter((listener) => !before.get(event)?.has(listener))
      .map((listener): AddedListener => [event, listener]),
  );
}

/**
 * Dispose one generation (ADR-168 step 5): drain it, worker then api, so its
 * stores, queues and pools close; then take off the listeners it added while
 * serving that its own close left behind. Answers how many it took off.
 */
export async function disposeGeneration({
  halves,
  emitter,
  added,
}: {
  halves: BackendHalves;
  emitter: ListenerHost;
  added: readonly AddedListener[];
}): Promise<number> {
  let removed = 0;
  try {
    await drainBackend(halves);
  } finally {
    for (const [event, listener] of added) {
      if (!emitter.listeners(event).includes(listener)) continue;
      emitter.off(event, listener);
      removed += 1;
    }
  }
  return removed;
}
