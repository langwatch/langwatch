/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import type { DatasetColumn } from "../types";
import { filterEmptyRows, convertInlineToRowRecords } from "../utils/datasetConversion";

describe("Save as dataset utilities", () => {
  describe("filterEmptyRows", () => {
    it("removes rows where all values are empty strings", () => {
      const records = [
        { id: "row_0", input: "hello", expected_output: "world" },
        { id: "row_1", input: "", expected_output: "" },
        { id: "row_2", input: "foo", expected_output: "" },
      ];

      const result = filterEmptyRows(records, ["input", "expected_output"]);

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe("row_0");
      expect(result[1]?.id).toBe("row_2");
    });

    it("keeps rows with at least one non-empty value", () => {
      const records = [
        { id: "row_0", col1: "", col2: "value" },
        { id: "row_1", col1: "value", col2: "" },
      ];

      const result = filterEmptyRows(records, ["col1", "col2"]);

      expect(result).toHaveLength(2);
    });

    it("removes all rows if all are empty", () => {
      const records = [
        { id: "row_0", input: "", output: "" },
        { id: "row_1", input: "", output: "" },
      ];

      const result = filterEmptyRows(records, ["input", "output"]);

      expect(result).toHaveLength(0);
    });

    it("handles undefined values as empty", () => {
      const records = [
        { id: "row_0", input: undefined as unknown as string, output: "" },
        { id: "row_1", input: "value", output: undefined as unknown as string },
      ];

      const result = filterEmptyRows(records, ["input", "output"]);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("row_1");
    });
  });

  describe("convertInlineToRowRecords", () => {
    it("converts column-based to row-based records", () => {
      const columns: DatasetColumn[] = [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ];
      const records = {
        input: ["hello", "world"],
        expected_output: ["hi", "earth"],
      };

      const result = convertInlineToRowRecords(columns, records);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "row_0", input: "hello", expected_output: "hi" });
      expect(result[1]).toEqual({ id: "row_1", input: "world", expected_output: "earth" });
    });

    it("filters out empty rows after conversion", () => {
      const columns: DatasetColumn[] = [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ];
      const records = {
        input: ["hello", "", ""],
        expected_output: ["world", "", ""],
      };

      const result = convertInlineToRowRecords(columns, records);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: "row_0", input: "hello", expected_output: "world" });
    });

    it("handles default 3 empty rows scenario", () => {
      const columns: DatasetColumn[] = [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ];
      // This simulates the default state: 3 rows, first filled, rest empty
      const records = {
        input: ["my input", "", ""],
        expected_output: ["my output", "", ""],
      };

      const result = convertInlineToRowRecords(columns, records);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: "row_0", input: "my input", expected_output: "my output" });
    });

    it("keeps partially filled rows", () => {
      const columns: DatasetColumn[] = [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ];
      const records = {
        input: ["hello", "partial", ""],
        expected_output: ["world", "", ""],
      };

      const result = convertInlineToRowRecords(columns, records);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "row_0", input: "hello", expected_output: "world" });
      expect(result[1]).toEqual({ id: "row_1", input: "partial", expected_output: "" });
    });

    it("returns empty array if all rows are empty", () => {
      const columns: DatasetColumn[] = [
        { id: "input", name: "input", type: "string" },
      ];
      const records = {
        input: ["", "", ""],
      };

      const result = convertInlineToRowRecords(columns, records);

      expect(result).toHaveLength(0);
    });
  });
});
