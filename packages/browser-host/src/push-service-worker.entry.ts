/**
 * The service worker script itself, bundled to `/push-sw.js` by the UI build. Only wires the
 * worker's events to the handlers in `push-service-worker.ts`.
 */
import {
  handleNotificationClick,
  handlePush,
  type PushWindowClient,
  type PushWorkerScope,
} from "./push-service-worker.ts";

/** The worker globals this script touches, typed here so the package keeps its DOM lib. */
interface WorkerGlobal {
  location: { origin: string };
  registration: {
    showNotification(title: string, options: Record<string, unknown>): Promise<void>;
  };
  clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<PushWindowClient[]>;
    openWindow(url: string): Promise<unknown>;
    claim(): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: WorkerEvent) => void): void;
}

interface WorkerEvent {
  waitUntil(promise: Promise<unknown>): void;
  data?: { json(): unknown } | null;
  notification?: { data: unknown; close(): void };
}

function isWorkerGlobal(value: object): value is WorkerGlobal {
  return "registration" in value && "clients" in value && "skipWaiting" in value;
}

function workerGlobal(): WorkerGlobal {
  const global: object = globalThis;
  if (!isWorkerGlobal(global)) throw new Error("push-sw.js runs only as a service worker");
  return global;
}

const worker = workerGlobal();

const scope: PushWorkerScope = {
  origin: worker.location.origin,
  matchWindowClients: () => worker.clients.matchAll({ type: "window", includeUncontrolled: true }),
  openWindow: (url) => worker.clients.openWindow(url),
  showNotification: (title, options) => worker.registration.showNotification(title, options),
  createChannel: () => new MessageChannel(),
};

function readJson(event: WorkerEvent): unknown {
  try {
    return event.data?.json() ?? null;
  } catch {
    return null;
  }
}

worker.addEventListener("install", (event) => event.waitUntil(worker.skipWaiting()));
worker.addEventListener("activate", (event) => event.waitUntil(worker.clients.claim()));
worker.addEventListener("push", (event) => event.waitUntil(handlePush(scope, readJson(event))));
worker.addEventListener("notificationclick", (event) => {
  event.notification?.close();
  event.waitUntil(handleNotificationClick(scope, event.notification?.data));
});
