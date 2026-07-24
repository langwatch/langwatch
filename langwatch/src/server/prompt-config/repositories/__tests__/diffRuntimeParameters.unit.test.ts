import { describe, expect, it } from "vitest";
import { diffRuntimeParameters } from "../llm-config-version-schema";

describe("diffRuntimeParameters()", () => {
  describe("given both sides are equal", () => {
    it("returns no differences", () => {
      expect(
        diffRuntimeParameters({ max_tokens: 500 }, { max_tokens: 500 }),
      ).toEqual([]);
    });

    it("treats undefined/null/empty object as equivalent", () => {
      expect(diffRuntimeParameters(undefined, null)).toEqual([]);
      expect(diffRuntimeParameters(null, {})).toEqual([]);
    });
  });

  describe("given a shared key changed value", () => {
    it("describes the change in a → b order", () => {
      expect(
        diffRuntimeParameters({ max_tokens: 1000 }, { max_tokens: 500 }),
      ).toEqual(["max_tokens: 1000 → 500"]);
    });
  });

  describe("given a key only present on one side", () => {
    it("describes a key added on the a side", () => {
      expect(diffRuntimeParameters({ seed: 42 }, {})).toEqual([
        "seed: 42 → undefined",
      ]);
    });

    it("describes a key only present on the b side", () => {
      expect(diffRuntimeParameters({}, { seed: 42 })).toEqual([
        "seed: undefined → 42",
      ]);
    });
  });

  describe("given multiple keys changed", () => {
    it("describes every changed key", () => {
      const result = diffRuntimeParameters(
        { max_tokens: 1000, top_p: 0.9 },
        { max_tokens: 500, top_p: 0.9 },
      );
      expect(result).toEqual(["max_tokens: 1000 → 500"]);
    });
  });
});
