import { afterEach, beforeEach, vi } from "vitest";

/**
 * Makes the global fetch throw for the duration of each test in the calling
 * suite.
 *
 * Node's global fetch is bound to the undici that ships inside Node, and it
 * rejects a dispatcher built by the undici npm package with
 * "InvalidArgumentError: invalid onRequestStart method". Code that passes a
 * dispatcher must therefore call undici's own fetch export. A suite that mocks
 * only that export would still pass if the code fell back to the global fetch,
 * so this guard turns that fallback into a clear failure.
 *
 * The stub is installed before each test and removed after it, because the
 * unit config runs with `isolate: false`: a stub left in place would reach
 * every later file in the same worker.
 *
 * It saves and restores the fetch property itself rather than calling
 * `vi.stubGlobal` and `vi.unstubAllGlobals`, for the same reason: those work on
 * one shared registry, so the cleanup would also drop globals that another file
 * in the worker installed.
 */
export function guardAgainstGlobalFetch(): void {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", {
      value: vi.fn(() => {
        throw new Error(
          "this code must call undici's fetch, not the global fetch",
        );
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
