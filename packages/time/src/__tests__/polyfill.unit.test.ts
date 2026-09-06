import { afterEach, describe, expect, it, vi } from "vitest";

const scope = globalThis as { Temporal?: unknown };

afterEach(() => {
  delete scope.Temporal;
  vi.resetModules();
});

describe("the polyfill module", () => {
  describe("given a runtime without a global Temporal", () => {
    /** @scenario "The polyfill module installs Temporal when the runtime has none" */
    it("installs one", async () => {
      delete scope.Temporal;
      vi.resetModules();

      await import("../polyfill.ts");

      expect(scope.Temporal).toBeDefined();
    });
  });

  describe("given a runtime that already provides Temporal", () => {
    /** @scenario "The polyfill module leaves a native Temporal alone" */
    it("leaves the runtime's own in place", async () => {
      const native = { marker: "native" };
      scope.Temporal = native;
      vi.resetModules();

      await import("../polyfill.ts");

      expect(scope.Temporal).toBe(native);
    });
  });
});
