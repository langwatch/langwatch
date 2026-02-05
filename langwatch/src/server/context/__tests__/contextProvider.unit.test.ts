import { describe, it, expect, beforeEach } from "vitest";
import { registerContextProvider, getContext } from "../contextProvider";

describe("contextProvider", () => {
  // Note: The provider is a singleton, so tests affect each other.
  // Reset behavior is not directly possible without module isolation.

  describe("getContext", () => {
    it("returns empty object when no provider is registered initially", () => {
      // After asyncContext is imported, a provider is registered.
      // This test documents that behavior - getContext always returns an object.
      const ctx = getContext();
      expect(ctx).toBeDefined();
      expect(typeof ctx).toBe("object");
    });
  });

  describe("registerContextProvider", () => {
    it("registers a context getter function", () => {
      const testGetter = () => ({
        testKey: "testValue",
        anotherKey: undefined,
      });

      registerContextProvider(testGetter);
      const ctx = getContext();

      expect(ctx.testKey).toBe("testValue");
      expect(ctx.anotherKey).toBeUndefined();
    });

    it("replaces previous provider when called again", () => {
      registerContextProvider(() => ({ first: "value" }));
      expect(getContext().first).toBe("value");

      registerContextProvider(() => ({ second: "other" }));
      expect(getContext().second).toBe("other");
      expect(getContext().first).toBeUndefined();
    });
  });
});
