import { Listr } from "listr2";

import type { RuntimeEvent } from "../shared/runtime-contract.ts";

const RING_SIZE = 5;

const INSTALL_TASKS = [
  { title: "preparing langwatch app", service: "prepare:app" },
  { title: "installing langevals deps", service: "prepare:langevals" },
  { title: "installing langwatch deps", service: "prepare:langwatch" },
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

type PanelTask = { output?: string; skip: (msg?: string) => void };
type FinishAwareRouter = InstallPanelRouter & { onInstallFinished(fn: () => void): void };

/** Appends a log line to the panel's tail, dropping blanks and the oldest line past the cap. */
function pushTailLine(ring: string[], line: string): boolean {
  const trimmed = line.replace(/\r/g, "").trim();
  if (trimmed.length === 0) return false;
  ring.push(trimmed);
  if (ring.length > RING_SIZE) ring.shift();
  return true;
}

/** One service's panel: tails its log until it is healthy, crashes, or was cached. */
function runInstallPanel({
  router,
  spec,
  task,
}: {
  router: InstallPanelRouter;
  spec: (typeof INSTALL_TASKS)[number];
  task: PanelTask;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ring: string[] = [];
    let started = false;

    router.subscribe(spec.service, (ev) => {
      if (ev.type === "starting") started = true;
      else if (ev.type === "log") {
        if (pushTailLine(ring, ev.line)) task.output = ring.join("\n");
      } else if (ev.type === "healthy") resolve();
      else if (ev.type === "crashed")
        reject(new Error(`${spec.service} crashed (exit ${ev.code})`));
    });

    (router as FinishAwareRouter).onInstallFinished(() => {
      if (!started) {
        task.skip("(cached)");
        resolve();
      }
    });
  });
}

// Render install-phase panels, one per service. Start before installServices().
export function renderInstallPanels(router: InstallPanelRouter): Promise<void> {
  const tasks = new Listr(
    INSTALL_TASKS.map((spec) => ({
      title: spec.title,
      task: (_: unknown, task: PanelTask) => runInstallPanel({ router, spec, task }),
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
