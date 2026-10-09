import type { EvaluatedModules } from "vite/module-runner";

/**
 * Every evaluated module a change reaches: the changed files' own modules and,
 * transitively, everything importing them. Untouched modules stay cached.
 */
export function staleModuleIds({
  modules,
  files,
}: {
  modules: EvaluatedModules;
  files: readonly string[];
}): Set<string> {
  const stale = new Set<string>();
  const queue = files.flatMap((file) =>
    [...(modules.getModulesByFile(file) ?? [])].map((node) => node.id),
  );
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (stale.has(id)) continue;
    stale.add(id);
    queue.push(...(modules.getModuleById(id)?.importers ?? []));
  }
  return stale;
}

/** Drops the named modules' evaluation, so the next import runs them again. */
export function invalidateModules({
  modules,
  ids,
}: {
  modules: EvaluatedModules;
  ids: Iterable<string>;
}): void {
  for (const id of ids) {
    const node = modules.getModuleById(id);
    if (node) modules.invalidateModule(node);
  }
}

/**
 * ADR-168's trigger policy, in-process: a quiet window with a max wait and
 * one reload at a time. Changes noted during a reload
 * wait out their own quiet window and are answered by one follow-up.
 */
export function createReloadTrigger({
  quietMs,
  maxWaitMs,
  run,
}: {
  quietMs: number;
  maxWaitMs: number;
  run: (files: string[]) => Promise<void>;
}): { note(file: string): void; cancel(): void } {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstAt = 0;
  let isRunning = false;
  const arm = (ms: number): void => {
    clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, ms));
  };
  function fire(): void {
    timer = undefined;
    if (isRunning || pending.size === 0) return;
    const files = [...pending];
    pending.clear();
    isRunning = true;
    void run(files).finally(() => {
      isRunning = false;
      if (pending.size > 0) arm(quietMs);
    });
  }
  return {
    note(file) {
      if (pending.size === 0) firstAt = Date.now();
      pending.add(file);
      arm(Math.min(quietMs, firstAt + maxWaitMs - Date.now()));
    },
    cancel() {
      clearTimeout(timer);
      pending.clear();
    },
  };
}

/** ADR-168 step 5's bounds on one host process; past either, a fresh process is cheaper. */
export type RecycleLimits = Readonly<{ maxGenerations: number; maxRssMiB: number }>;

/**
 * Why the next reload should be a fresh process instead of a re-link, or
 * undefined while re-linking stays safe. Module-level state leaks a little per
 * generation, and a generation that did not drain may still hold its pools.
 */
export function recycleReason({
  generation,
  rssMiB,
  isDrainFailed = false,
  limits,
}: {
  generation: number;
  rssMiB: number;
  isDrainFailed?: boolean;
  limits: RecycleLimits;
}): string | undefined {
  if (isDrainFailed) return `generation ${generation} did not drain`;
  if (generation >= limits.maxGenerations) {
    return `generation ${generation} reached the limit of ${limits.maxGenerations}`;
  }
  if (rssMiB > limits.maxRssMiB) {
    return `rss ${rssMiB} MiB passed the ceiling of ${limits.maxRssMiB} MiB`;
  }
  return undefined;
}
