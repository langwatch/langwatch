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

  describe("when runId is provided", () => {
    it("includes the runId in the fallback name", () => {
      const result = getRunDisplayName({
        commitMessage: undefined,
        runId: "abc123",
        index: 0,
      });
      expect(result).toBe("Run #1 (abc123)");
    });

    it("truncates long runId values", () => {
      const result = getRunDisplayName({
        commitMessage: undefined,
        runId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        index: 0,
      });
      expect(result).toBe("Run #1 (a1b2c3d4…)");
    });

    it("still prefers commitMessage over runId", () => {
      const result = getRunDisplayName({
        commitMessage: "Add retry logic",
        runId: "abc123",
        index: 0,
      });
      expect(result).toBe("Add retry logic");
    });
  });
});
