import { describe, expect, it, vi } from "vitest";
import { asNonEmptyIO, fetchExistingMD5s } from "./collectorWorker";

describe("collectorWorker unit tests", () => {
  describe("asNonEmptyIO helper function", () => {
    it("should return undefined for null input", () => {
      expect(asNonEmptyIO(null)).toBeUndefined();
    });

    it("should return undefined for undefined input", () => {
      expect(asNonEmptyIO(void 0)).toBeUndefined();
    });

    it("should return undefined for empty string value", () => {
      expect(asNonEmptyIO({ value: "" })).toBeUndefined();
    });

    it("should return undefined for whitespace-only string value", () => {
      expect(asNonEmptyIO({ value: "   " })).toBeUndefined();
      expect(asNonEmptyIO({ value: "\t\n\r" })).toBeUndefined();
    });

    it("should return the object as-is for non-empty string value", () => {
      const input = { value: "Hello World" };
      expect(asNonEmptyIO(input)).toBe(input);
    });

    it("should return the object as-is for string with leading/trailing whitespace", () => {
      const input = { value: "  Hello World  " };
      expect(asNonEmptyIO(input)).toBe(input);
    });

    it("should return the object as-is for string with only whitespace but non-empty after trim", () => {
      const input = { value: "  Hello  " };
      expect(asNonEmptyIO(input)).toBe(input);
    });
  });

  describe("fetchExistingMD5s", () => {
    describe("when ELASTICSEARCH_NODE_URL is unset", () => {
      it("returns undefined without attempting ES query", async () => {
        vi.mock("../../../env.mjs", () => ({
          env: { ELASTICSEARCH_NODE_URL: undefined },
        }));

        const result = await fetchExistingMD5s("trace-123", "project-456");
        expect(result).toBeUndefined();
      });
    });
  });
});
