import net from "node:net";

import type { BootFailure } from "./boot-failure.ts";

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
/** A boot's outcome: the api always serves; a worker that refused boot is named, not thrown. */
export type BootedBackend = Readonly<{ halves: BackendHalves; workerFailure?: unknown }>;

const IDLE_WORKER: BackendWorkerHalf = { close: async () => {} };

export type BackendStartOptions = {
  startApi: (options: BackendHalfOptions & { port?: number }) => Promise<BackendApiHalf>;
  startWorker: (options: BackendHalfOptions) => Promise<BackendWorkerHalf>;
};

/**
 * Start both halves together: the api answers at once while the worker runs the upgrade, and a
 * queue with no consumer yet is fine (Alex, 2026-10-09, API-UP-DURING-UPGRADE). A refused api
 * drains the worker and throws; a refused worker never takes the api down (Alex, 2026-10-10).
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

/**
 * A reload beside a serving generation: the next api boots on `apiPort`, `route` moves the port
 * to it, the old one drains, the next worker starts. A refused api leaves the old one untouched.
 * Spec: specs/setup/dev-process-topology.feature
 */
export async function replaceBackend({
  startApi,
  startWorker,
  apiPort,
  route,
  disposeOld,
}: BackendStartOptions & {
  apiPort: number;
  route: (port: number) => void;
  disposeOld: () => Promise<void>;
}): Promise<BootedBackend> {
  const api = await bootHalf("api", () =>
    startApi({ ownsProcess: false, ownsTelemetry: false, port: apiPort }),
  );
  route(apiPort);
  await disposeOld();
  try {
    const worker = await bootHalf("worker", () =>
      startWorker({ ownsProcess: false, ownsTelemetry: true }),
    );
    return { halves: { api, worker } };
  } catch (workerFailure) {
    return { halves: { api, worker: IDLE_WORKER }, workerFailure };
  }
}

/** A port nothing on loopback holds right now, for the next api generation to bind. */
export async function freeLoopbackPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no loopback port bound");
  return address.port;
}

/** The api's stable port: `route` moves it to a generation, `report` says why it is not whole. */
export type PortForwarder = Readonly<{
  route(port: number): void;
  report(failure: BootFailure | undefined): void;
  close(): Promise<void>;
}>;

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
