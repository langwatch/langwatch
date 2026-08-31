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
 * It removes every global stub, so do not use it in a suite that installs
 * other globals with `vi.stubGlobal` and expects them to survive a test.
 */
export function guardAgainstGlobalFetch(): void {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error(
          "this code must call undici's fetch, not the global fetch",
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}
