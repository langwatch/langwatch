import { afterEach, beforeEach, vi } from "vitest";

/**
 * Guards code to use undici's fetch (not global). Per-test stub for isolate:
 * false to avoid reaching other files.
 */
export function guardAgainstGlobalFetch(): void {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", {
      value: vi.fn(() => {
        throw new Error("this code must call undici's fetch, not the global fetch");
      }),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, "fetch", original);
    } else {
      // The runtime had no fetch of its own, so leaving the stub behind would
      // invent one for every later file in the worker.
      delete (globalThis as { fetch?: unknown }).fetch;
    }
    original = undefined;
  });
}
