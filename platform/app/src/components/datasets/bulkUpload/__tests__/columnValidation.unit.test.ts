import { describe, expect, it } from "vitest";
import type { DatasetConfirmColumns } from "~/server/datasets/types";
import { invalidColumnNameKeys } from "../columnValidation";

const col = (
  name: string,
  sourceHeader: string,
): DatasetConfirmColumns[number] => ({
  name,
  type: "string",
  sourceHeader,
});

describe("invalidColumnNameKeys()", () => {
  describe("given all names are unique and non-empty", () => {
    it("flags nothing", () => {
      const columns = [col("a", "a"), col("b", "b")];
      expect(invalidColumnNameKeys(columns).size).toBe(0);
    });
  });

  describe("when two columns share a name", () => {
    it("flags both colliding columns by sourceHeader", () => {
      const columns = [col("input", "a"), col("input", "b"), col("ok", "c")];
      expect(invalidColumnNameKeys(columns)).toEqual(new Set(["a", "b"]));
    });
  });

  describe("when a name is blank or whitespace-only", () => {
    it("flags it", () => {
      const columns = [col("", "a"), col("   ", "b"), col("ok", "c")];
      expect(invalidColumnNameKeys(columns)).toEqual(new Set(["a", "b"]));
    });
  });

  describe("when names differ only by surrounding whitespace", () => {
    it("does not flag them (distinct record keys, no collision)", () => {
      const columns = [col("a", "h1"), col("a ", "h2")];
      expect(invalidColumnNameKeys(columns).size).toBe(0);
    });
  });
});
