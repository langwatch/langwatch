/**
 * @vitest-environment node
 */

import { afterAll, describe, expect, it, vi } from "vitest";

import { guardAgainstGlobalFetch } from "../globalFetchGuard";

const realFetch = globalThis.fetch;

// A global that belongs to another suite sharing this worker. The guard's
// cleanup must leave it alone: the unit config runs with `isolate: false`, so
// a cleanup that dropped every global stub would take this one with it.
const otherGlobal = Symbol("other-global");
vi.stubGlobal("langwatchGuardProbe", otherGlobal);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("guardAgainstGlobalFetch", () => {
  guardAgainstGlobalFetch();

  describe("given a test running under the guard", () => {
    it("makes a call to the global fetch throw", () => {
      expect(() => globalThis.fetch("https://example.com")).toThrow(
        "this code must call undici's fetch, not the global fetch",
      );
    });

    it("installs the guard again for the next test in the suite", () => {
      expect(() => globalThis.fetch("https://example.com")).toThrow(
        "this code must call undici's fetch, not the global fetch",
      );
    });

    it("leaves globals it does not own untouched", () => {
      expect(
        (globalThis as { langwatchGuardProbe?: symbol }).langwatchGuardProbe,
      ).toBe(otherGlobal);
    });
  });
});

describe("after a guarded suite has finished a test", () => {
  it("has put the real global fetch back", () => {
    expect(globalThis.fetch).toBe(realFetch);
  });
});
