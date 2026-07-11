import { describe, expect, it } from "vitest";
import { reconcileOptimisticText } from "../logic/langyOptimisticText";

describe("reconcileOptimisticText", () => {
  describe("given no fast text yet", () => {
    it("renders the durable text", () => {
      expect(reconcileOptimisticText("Hello", undefined)).toBe("Hello");
      expect(reconcileOptimisticText("Hello", null)).toBe("Hello");
      expect(reconcileOptimisticText("Hello", "")).toBe("Hello");
    });
  });

  describe("when the fast text leads and is a superset of the durable text", () => {
    it("renders the fast text", () => {
      // Durable is empty at first — fast shows immediately.
      expect(reconcileOptimisticText("", "Hel")).toBe("Hel");
      // Durable caught up one 64-word batch; fast is still ahead per-token.
      expect(reconcileOptimisticText("Hello wor", "Hello world")).toBe(
        "Hello world",
      );
    });
  });

  describe("when the durable text has caught up to the fast text", () => {
    it("renders the durable text (no shorter flash)", () => {
      // Equal length → not strictly greater → durable wins.
      expect(reconcileOptimisticText("Hello world", "Hello world")).toBe(
        "Hello world",
      );
      // Durable overtook fast (end-of-turn tail flush) → durable wins.
      expect(reconcileOptimisticText("Hello world!", "Hello world")).toBe(
        "Hello world!",
      );
    });
  });

  describe("when the fast text has a gap and is not a clean superset", () => {
    it("falls back to the durable text so nothing corrupt renders", () => {
      // Fast missed the leading "H" (subscribed a token late). It is longer but
      // not prefix-consistent — durable must win.
      expect(reconcileOptimisticText("Hello", "ello world")).toBe("Hello");
      // Divergent content mid-stream.
      expect(reconcileOptimisticText("Hello team", "Hello world")).toBe(
        "Hello team",
      );
    });
  });
});
