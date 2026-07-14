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
    /** @scenario A run without a commit message shows index then a middle-dot separator */
    it("joins the index and runId with a gray middle-dot separator, no parentheses", () => {
      const result = getRunDisplayName({
        commitMessage: undefined,
        runId: "snobbish-otter-1f2a3b",
        index: 9,
      });
      expect(result).toBe("Run #10 · snobbish-otter-1f2a3b");
      expect(result).not.toContain("(");
      expect(result).not.toContain(")");
    });

    /** @scenario The run id uses the available width instead of an early hard truncation */
    it("keeps the full runId without pre-truncating to eight characters", () => {
      const result = getRunDisplayName({
        commitMessage: undefined,
        runId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        index: 0,
      });
      expect(result).toBe("Run #1 · a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(result).not.toContain("…");
    });

    /** @scenario A run with a commit message still shows the commit message */
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
