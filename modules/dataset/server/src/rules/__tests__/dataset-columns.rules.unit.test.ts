/**
 * A write naming a column the dataset does not define is refused rather than silently dropped,
 * so a caller never reads a success for data nothing stored.
 */
import { describe, expect, it } from "vitest";
import { InvalidColumnError } from "@langwatch/dataset-contract";
import { assertKnownColumns } from "../dataset-columns.rules.ts";

describe("assertKnownColumns", () => {
  describe("when every key is a defined column", () => {
    it("accepts the entries", () => {
      expect(() =>
        assertKnownColumns({
          datasetName: "Refunds",
          columns: ["input", "output"],
          entries: [{ input: "a", output: "b" }],
        }),
      ).not.toThrow();
    });
  });

  describe("when an entry carries the reserved id key", () => {
    it("accepts it without the dataset defining an id column", () => {
      expect(() =>
        assertKnownColumns({
          datasetName: "Refunds",
          columns: ["input"],
          entries: [{ id: "record-1", input: "a" }],
        }),
      ).not.toThrow();
    });
  });

  describe("when an entry names an undefined column", () => {
    it("refuses naming the column and the valid columns", () => {
      let thrown: unknown;
      try {
        assertKnownColumns({
          datasetName: "Refunds",
          columns: ["input", "output"],
          entries: [{ input: "a" }, { notes: "b" }],
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InvalidColumnError);
      expect((thrown as InvalidColumnError).columnName).toBe("notes");
      expect((thrown as InvalidColumnError).validColumns).toEqual(["input", "output"]);
    });
  });
});
