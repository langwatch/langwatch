import net from "node:net";

import {
  bootHalf,
  drainBackend,
  IDLE_WORKER,
  type BackendHalves,
  type BackendStartOptions,
  type BootedBackend,
} from "@langwatch/process/backend-host";

import type { BootFailure } from "./boot-failure.ts";

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
