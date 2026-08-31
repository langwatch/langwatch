/**
 * @vitest-environment node
 */

import { afterAll, describe, expect, it } from "vitest";

import { guardAgainstGlobalFetch } from "../globalFetchGuard";

const realFetch = globalThis.fetch;

// A global that belongs to another suite sharing this worker. The guard's
// cleanup must leave it alone: the unit config runs with `isolate: false`, so
// a cleanup that dropped every global stub would take this one with it.
//
// It is installed and removed by hand for that same reason, since
// `vi.stubGlobal` and `vi.unstubAllGlobals` work on one shared registry.
const probe = Symbol("langwatch-guard-probe");
Object.defineProperty(globalThis, "langwatchGuardProbe", {
  value: probe,
  configurable: true,
  writable: true,
});

afterAll(() => {
  delete (globalThis as { langwatchGuardProbe?: symbol }).langwatchGuardProbe;
});

describe("guardAgainstGlobalFetch", () => {
  describe("given a suite that installed the guard", () => {
    guardAgainstGlobalFetch();

    describe("when a test calls the global fetch", () => {
      it("throws and names undici's fetch as the one to use", () => {
        expect(() => globalThis.fetch("https://example.com")).toThrow(
          "this code must call undici's fetch, not the global fetch",
        );
      });
    });

    describe("when a second test in the same suite calls it", () => {
      it("throws as well, so every test carries the guard", () => {
        expect(() => globalThis.fetch("https://example.com")).toThrow(
          "this code must call undici's fetch, not the global fetch",
        );
      });
    });

    describe("when a test reads a global the guard does not own", () => {
      it("still finds the value the other suite installed", () => {
        expect(
          (globalThis as { langwatchGuardProbe?: symbol }).langwatchGuardProbe,
        ).toBe(probe);
      });
    });
  });

  describe("given a guarded suite that has finished its tests", () => {
    describe("when an unguarded test reads the global fetch", () => {
      it("gets the real fetch back", () => {
        expect(globalThis.fetch).toBe(realFetch);
      });
    });
  });
});
