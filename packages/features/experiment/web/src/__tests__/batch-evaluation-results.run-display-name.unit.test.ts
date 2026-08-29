import { describe, expect, it } from "vitest";
import { getRunDisplayName } from "../batch-evaluation-results.run-display-name";

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

  describe("when commitMessage is absent", () => {
    it("returns a human-readable 1-based index", () => {
      const result = getRunDisplayName({
        commitMessage: void 0,
        index: 0,
      });

      expect(result).toBe("Run #1");
      expect(getRunDisplayName({ commitMessage: void 0, index: 4 })).toBe("Run #5");
    });

    it("treats null and an empty string as absent", () => {
      expect(getRunDisplayName({ commitMessage: null, index: 2 })).toBe("Run #3");
      expect(getRunDisplayName({ commitMessage: "", index: 0 })).toBe("Run #1");
    });
  });

  describe("when runId is provided", () => {
    it("keeps the full id after the run index", () => {
      const result = getRunDisplayName({
        commitMessage: void 0,
        runId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        index: 9,
      });

      expect(result).toBe("Run #10 · a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(result).not.toContain("(");
      expect(result).not.toContain(")");
      expect(result).not.toContain("…");
    });

    it("still prefers the commit message", () => {
      expect(
        getRunDisplayName({
          commitMessage: "Add retry logic",
          runId: "abc123",
          index: 0,
        }),
      ).toBe("Add retry logic");
    });
  });
});
