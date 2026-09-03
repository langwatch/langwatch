/**
 * @vitest-environment node
 */

import { afterAll, describe, expect, it, vi } from "vitest";

import { guardAgainstGlobalFetch } from "../globalFetchGuard";

const realFetch = globalThis.fetch;

// A global that belongs to another suite sharing this worker. The guard's
// cleanup must leave it alone: the unit config runs with `isolate: false`, so
// a cleanup that dropped every global stub would take this one with it.
//
// `vi.stubGlobal` is what such a suite would use, and it is what puts the
// probe in the registry that `vi.unstubAllGlobals` empties. Installing it any
// other way would hide it from that call, and the test below could no longer
// tell a targeted cleanup from a wholesale one.
const probe = Symbol("langwatch-guard-probe");
vi.stubGlobal("langwatchGuardProbe", probe);

// Removed by hand rather than with `vi.unstubAllGlobals`, which would empty
// the same shared registry this file asks the guard not to touch.
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
        expect((globalThis as { langwatchGuardProbe?: symbol }).langwatchGuardProbe).toBe(probe);
      });
    });
  });

  describe("given a guarded suite that has finished its tests", () => {
    describe("when an unguarded test reads the global fetch", () => {
      it("gets the real fetch back", () => {
        expect(globalThis.fetch).toBe(realFetch);
      });
    });

    // The same assertion as inside the suite, made once every cleanup has run.
    // That one holds only while it is not the first test of its suite, since
    // it reads what the cleanups before it left behind. This one does not
    // depend on the order the tests above it are written in.
    describe("when an unguarded test reads a global the guard does not own", () => {
      it("still finds the value the other suite installed", () => {
        expect((globalThis as { langwatchGuardProbe?: symbol }).langwatchGuardProbe).toBe(probe);
      });
    });
  });
});
