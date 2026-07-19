import { describe, expect, it } from "vitest";
import { datasetConfirmColumnsSchema } from "../types";

/**
 * The confirm-columns schema is the upload route's boundary guard: its `name`s
 * become stored record keys, so blank or duplicated names must be rejected (not
 * silently downgraded) before they can corrupt a dataset.
 */
describe("datasetConfirmColumnsSchema", () => {
  describe("given unique, non-empty names", () => {
    it("accepts the payload", () => {
      const result = datasetConfirmColumnsSchema.safeParse([
        { name: "input", type: "string", sourceHeader: "a" },
        { name: "output", type: "string", sourceHeader: "b" },
      ]);
      expect(result.success).toBe(true);
    });
  });

  describe("when two columns share a name", () => {
    it("rejects the payload", () => {
      const result = datasetConfirmColumnsSchema.safeParse([
        { name: "input", type: "string", sourceHeader: "a" },
        { name: "input", type: "string", sourceHeader: "b" },
      ]);
      expect(result.success).toBe(false);
    });
  });

  describe("when a name is blank or whitespace-only", () => {
    it("rejects the payload", () => {
      expect(
        datasetConfirmColumnsSchema.safeParse([
          { name: "", type: "string", sourceHeader: "a" },
        ]).success,
      ).toBe(false);
      expect(
        datasetConfirmColumnsSchema.safeParse([
          { name: "   ", type: "string", sourceHeader: "a" },
        ]).success,
      ).toBe(false);
    });
  });
});
