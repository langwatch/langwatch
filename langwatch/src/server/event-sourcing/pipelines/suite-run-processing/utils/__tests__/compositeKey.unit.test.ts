import { describe, it, expect } from "vitest";
import { makeSuiteRunKey, parseSuiteRunKey } from "../compositeKey";

describe("compositeKey", () => {
  describe("when making a suite run key", () => {
    it("combines suiteId and batchRunId with colon separator", () => {
      expect(makeSuiteRunKey("suite-123", "batch-456")).toBe("suite-123:batch-456");
    });
  });

  describe("when parsing a suite run key", () => {
    it("extracts suiteId and batchRunId", () => {
      const result = parseSuiteRunKey("suite-123:batch-456");
      expect(result.suiteId).toBe("suite-123");
      expect(result.batchRunId).toBe("batch-456");
    });

    it("handles batchRunId containing colons", () => {
      const result = parseSuiteRunKey("suite-123:batch:with:colons");
      expect(result.suiteId).toBe("suite-123");
      expect(result.batchRunId).toBe("batch:with:colons");
    });

    it("throws for invalid key without separator", () => {
      expect(() => parseSuiteRunKey("invalid-key")).toThrow("Invalid suite run key");
    });
  });

  describe("when round-tripping", () => {
    it("produces the original values", () => {
      const key = makeSuiteRunKey("s1", "b1");
      const parsed = parseSuiteRunKey(key);
      expect(parsed.suiteId).toBe("s1");
      expect(parsed.batchRunId).toBe("b1");
    });
  });
});
