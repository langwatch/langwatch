import { afterEach, beforeEach, vi } from "vitest";

// Guard that makes global fetch throw, ensuring code calls undici's fetch
// (installed/removed per test to avoid isolation issues with isolate: false)
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
