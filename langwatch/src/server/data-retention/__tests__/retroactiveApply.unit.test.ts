import { describe, expect, it } from "vitest";
import { classifyRetentionChange } from "../retroactive/retroactiveApply";

describe("classifyRetentionChange", () => {
  describe("when the retention window shrinks", () => {
    it("is a contraction (existing data becomes deletable)", () => {
      expect(classifyRetentionChange({ current: 91, next: 49 })).toBe(
        "contraction",
      );
    });

    describe("given the data was previously kept indefinitely", () => {
      // Indefinite (0) is the longest possible window, so moving to any finite
      // day count shrinks it — and is the most destructive change of all.
      it("is a contraction", () => {
        expect(classifyRetentionChange({ current: 0, next: 49 })).toBe(
          "contraction",
        );
      });
    });
  });

  describe("when the retention window grows", () => {
    it("is an expansion (nothing is deleted)", () => {
      expect(classifyRetentionChange({ current: 49, next: 91 })).toBe(
        "expansion",
      );
    });

    describe("given the new retention is indefinite", () => {
      it("is an expansion", () => {
        expect(classifyRetentionChange({ current: 49, next: 0 })).toBe(
          "expansion",
        );
      });
    });
  });

  describe("when the retention window is unchanged", () => {
    it("is a noop for a finite value", () => {
      expect(classifyRetentionChange({ current: 49, next: 49 })).toBe("noop");
    });

    it("is a noop for indefinite", () => {
      expect(classifyRetentionChange({ current: 0, next: 0 })).toBe("noop");
    });
  });
});
