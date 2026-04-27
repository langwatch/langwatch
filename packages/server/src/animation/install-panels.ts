import { Listr } from "listr2";
import type { RuntimeEvent } from "../shared/runtime-contract.ts";

const RING_SIZE = 5;

const INSTALL_TASKS = [
  { title: "relocating @langwatch/server tree", service: "app:relocate" },
  { title: "syncing langwatch_nlp venv (uv)", service: "uv:langwatch_nlp" },
  { title: "syncing langevals venv (uv)", service: "uv:langevals" },
  { title: "installing langwatch app deps (pnpm)", service: "pnpm:langwatch" },
] as const;

const INSTALL_SERVICES: ReadonlySet<string> = new Set(INSTALL_TASKS.map((t) => t.service));

export function isInstallEvent(ev: RuntimeEvent): boolean {
  return INSTALL_SERVICES.has(ev.service);
}

type Subscription = (ev: RuntimeEvent) => void;

export interface InstallPanelRouter {
  subscribe(service: string, fn: Subscription): void;
  feed(ev: RuntimeEvent): void;
  installFinished(): void;
}

export function makeInstallPanelRouter(): InstallPanelRouter {
  const buffered = new Map<string, RuntimeEvent[]>();
  const listeners = new Map<string, Subscription>();
  const finishedListeners = new Set<() => void>();
  let finished = false;

  return {
    subscribe(service, fn) {
      listeners.set(service, fn);
      const queue = buffered.get(service);
      if (queue) {
        for (const ev of queue) fn(ev);
        buffered.delete(service);
      }
    },
    feed(ev) {
      if (!INSTALL_SERVICES.has(ev.service)) return;
      const fn = listeners.get(ev.service);
      if (fn) {
        fn(ev);
        return;
      }
      const queue = buffered.get(ev.service) ?? [];
      queue.push(ev);
      buffered.set(ev.service, queue);
    },
    installFinished() {
      if (finished) return;
      finished = true;
      for (const fn of finishedListeners) fn();
      finishedListeners.clear();
    },
    // exposed via prototype-style closure: tasks call back through subscribe()
    // for events, and (separately) await an install-finished signal so cached
    // steps that never emit can complete.
    onInstallFinished(fn: () => void) {
      if (finished) {
        fn();
        return;
      }
      finishedListeners.add(fn);
    },
  } as InstallPanelRouter & { onInstallFinished(fn: () => void): void };
}

/**
 * Render docker-buildx-style bounded panels for the install phase. One
 * panel per service, each showing the last RING_SIZE lines of its
 * captured stdout/stderr. Resolves when every panel closes (either via
 * a `healthy` event from the service or via `installFinished()` for
 * cached steps that never emit).
 *
 * Must be started BEFORE installServices() — the router buffers any
 * events that arrive before listr2 has subscribed.
 */
export function renderInstallPanels(router: InstallPanelRouter): Promise<void> {
  const tasks = new Listr(
    INSTALL_TASKS.map((spec) => ({
      title: spec.title,
      task: (_: unknown, task: { output?: string; skip: (msg?: string) => void }) =>
        new Promise<void>((resolve, reject) => {
          const ring: string[] = [];
          let started = false;

          router.subscribe(spec.service, (ev) => {
            if (ev.type === "starting") {
              started = true;
              return;
            }
            if (ev.type === "log") {
              const trimmed = ev.line.replace(/\r/g, "").trim();
              if (trimmed.length === 0) return;
              ring.push(trimmed);
              if (ring.length > RING_SIZE) ring.shift();
              task.output = ring.join("\n");
              return;
            }
            if (ev.type === "healthy") {
              resolve();
              return;
            }
            if (ev.type === "crashed") {
              reject(new Error(`${spec.service} crashed (exit ${ev.code})`));
              return;
            }
          });

          (router as InstallPanelRouter & { onInstallFinished(fn: () => void): void }).onInstallFinished(
            () => {
              if (!started) {
                task.skip("(cached)");
                resolve();
              }
            },
          );
        }),
    })),
    {
      concurrent: true,
      exitOnError: false,
      collectErrors: "minimal",
      rendererOptions: { collapseSubtasks: false },
    },
  );

  return tasks.run().then(
    () => undefined,
    () => undefined,
  );
}
