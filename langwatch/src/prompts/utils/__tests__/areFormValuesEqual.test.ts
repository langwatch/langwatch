import { describe, expect, it } from "vitest";
import { areFormValuesEqual } from "../areFormValuesEqual";

describe("areFormValuesEqual", () => {
  describe("when either value is falsy", () => {
    it("returns false when first value is undefined", () => {
      const result = areFormValuesEqual(undefined, { handle: "test" });
      expect(result).toBe(false);
    });

    it("returns false when second value is undefined", () => {
      const result = areFormValuesEqual({ handle: "test" }, undefined);
      expect(result).toBe(false);
    });

    it("returns false when first value is null", () => {
      const result = areFormValuesEqual(null as any, { handle: "test" });
      expect(result).toBe(false);
    });
  });

  describe("when both values are present", () => {
    it("returns true when values are deeply equal", () => {
      const value1 = {
        handle: "test",
        version: { configData: { prompt: "test prompt" } },
      };
      const value2 = {
        handle: "test",
        version: { configData: { prompt: "test prompt" } },
      };
      const result = areFormValuesEqual(value1, value2);
      expect(result).toBe(true);
    });

    it("returns false when values differ", () => {
      const value1 = { handle: "test1" };
      const value2 = { handle: "test2" };
      const result = areFormValuesEqual(value1, value2);
      expect(result).toBe(false);
    });

    it("normalizes dates via JSON for comparison", () => {
      const date = new Date("2024-01-01");
      const value1 = { handle: "test", createdAt: date };
      const value2 = {
        handle: "test",
        createdAt: new Date(date.getTime()),
      };
      const result = areFormValuesEqual(value1, value2);
      expect(result).toBe(true);
    });
  });
});
