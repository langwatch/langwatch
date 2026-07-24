import { describe, it, expect } from "vitest";
import { Deferred } from "../deferred";

describe("Deferred", () => {
  describe("when resolved before calling fn", () => {
    it("delegates to the resolved function", async () => {
      const deferred = new Deferred<(x: number, y: string) => string>("test");
      deferred.resolve((x, y) => `${y}-${x}`);

      expect(deferred.fn(42, "hello")).toBe("hello-42");
    });

    it("reports isResolved as true", () => {
      const deferred = new Deferred<() => void>("test");
      deferred.resolve(() => {});

      expect(deferred.isResolved).toBe(true);
    });
  });

  describe("when calling fn before resolve", () => {
    it("throws with the deferred name", () => {
      const deferred = new Deferred<(x: number) => number>("myDispatcher");

      expect(() => deferred.fn(1)).toThrow(
        'Deferred "myDispatcher" not yet resolved',
      );
    });

    it("reports isResolved as false", () => {
      const deferred = new Deferred<() => void>("test");

      expect(deferred.isResolved).toBe(false);
    });
  });

  describe("when resolve is called twice", () => {
    it("throws on the second call", () => {
      const deferred = new Deferred<() => void>("test");
      deferred.resolve(() => {});

      expect(() => deferred.resolve(() => {})).toThrow(
        'Deferred "test" already resolved',
      );
    });
  });

  describe("when used with async functions", () => {
    it("returns the promise from the resolved function", async () => {
      const deferred = new Deferred<(n: number) => Promise<number>>("async");
      deferred.resolve(async (n) => n * 2);

      await expect(deferred.fn(5)).resolves.toBe(10);
    });
  });

  describe("when fn is passed as a callback before resolve", () => {
    it("works when the callback is invoked after resolve", () => {
      const deferred = new Deferred<(s: string) => string>("late");
      const callback = deferred.fn; // capture reference

      deferred.resolve((s) => s.toUpperCase());

      expect(callback("hello")).toBe("HELLO");
    });
  });
});
