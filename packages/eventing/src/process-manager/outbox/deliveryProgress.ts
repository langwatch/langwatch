import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which outbox delivery the running code belongs to, as the mark that renews its
 * lease. Framework-only: a module never reads it (ARCHITECTURE.md section 9).
 */
const currentDelivery = new AsyncLocalStorage<() => void>();

/** How far below a tracked dependency calls are still seen: a client, its delegate, the method. */
const TRACKED_DEPTH = 2;

/** Runs one delivery's handler so every call through a tracked dependency marks its progress. */
export function runDeliveryMarkingProgress<Result>({
  markProgress,
  run,
}: {
  markProgress: () => void;
  run: () => Result;
}): Result {
  return currentDelivery.run(markProgress, run);
}

/**
 * Runs `start` outside any delivery, so a timer it arms (a lock or claim renewal) never
 * marks the delivery that happened to start it: a hung handler still goes silent.
 */
export function runOutsideDelivery<Result>(start: () => Result): Result {
  return currentDelivery.exit(start);
}

/**
 * The dependency with each call marking the current delivery's progress when it
 * starts and when its promise settles. Outside a delivery a call passes straight
 * through. Lazy thenables (a Prisma query) are never awaited, so never run early.
 */
export function trackDeliveryProgress<Dependency>(dependency: Dependency): Dependency {
  if (typeof dependency === "function") {
    return trackedCall(dependency, undefined) as Dependency;
  }
  if (typeof dependency !== "object" || dependency === null) return dependency;
  return trackedObject(dependency, 0);
}

function trackedCall(call: Function, owner: object | undefined): Function {
  return function tracked(this: unknown, ...args: unknown[]): unknown {
    const markProgress = currentDelivery.getStore();
    const self = owner ?? this;
    if (markProgress === undefined) return Reflect.apply(call, self, args);
    markProgress();
    const result: unknown = Reflect.apply(call, self, args);
    if (result instanceof Promise) void result.then(markProgress).catch(markProgress);
    return result;
  };
}

function trackedObject<Target extends object>(target: Target, depth: number): Target {
  // Per key, the last value read and what was handed back for it, so a repeat read is one lookup.
  const handedBack = new Map<string, { value: unknown; tracked: unknown }>();
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key);
      if (typeof key === "symbol" || key === "constructor") return value;
      const last = handedBack.get(key);
      if (last !== undefined && last.value === value) return last.tracked;
      const tracked = trackedValue({ object, key, value, depth });
      handedBack.set(key, { value, tracked });
      return tracked;
    },
  });
}

function trackedValue({
  object,
  key,
  value,
  depth,
}: {
  object: object;
  key: string;
  value: unknown;
  depth: number;
}): unknown {
  if (typeof value === "function") return isFixed(object, key) ? value : trackedCall(value, object);
  if (typeof value !== "object" || value === null || depth >= TRACKED_DEPTH) return value;
  return isFixed(object, key) ? value : trackedObject(value, depth + 1);
}

/** A read-only, non-configurable property must come back as itself (the Proxy invariant). */
function isFixed(object: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return (
    descriptor !== undefined &&
    descriptor.configurable === false &&
    "value" in descriptor &&
    descriptor.writable === false
  );
}
