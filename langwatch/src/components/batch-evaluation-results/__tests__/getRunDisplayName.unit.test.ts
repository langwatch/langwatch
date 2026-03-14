import { describe, expect, it } from "vitest";
import { getRunDisplayName } from "../getRunDisplayName";

describe("getRunDisplayName()", () => {
  describe("when commitMessage is present", () => {
    it("returns the commit message", () => {
      const result = getRunDisplayName({
        commitMessage: "Add retry logic",
        index: 0,
      });
      expect(result).toBe("Add retry logic");
    });
  });

  describe("when commitMessage is undefined", () => {
    it("returns a human-readable name based on 1-based index", () => {
      const result = getRunDisplayName({
        commitMessage: undefined,
        index: 0,
      });
      expect(result).toBe("Run #1");
    });

    it("uses the correct 1-based index", () => {
      expect(getRunDisplayName({ commitMessage: undefined, index: 4 })).toBe(
        "Run #5"
      );
    });
  });

  describe("when commitMessage is null", () => {
    it("returns a human-readable name instead of a raw ID", () => {
      const result = getRunDisplayName({
        commitMessage: null,
        index: 2,
      });
      expect(result).toBe("Run #3");
    });
  });

  describe("when commitMessage is an empty string", () => {
    it("treats empty string as missing and returns Run #N", () => {
      const result = getRunDisplayName({
        commitMessage: "",
        index: 0,
      });
      expect(result).toBe("Run #1");
    });
  });
});
