import { describe, expect, it } from "vitest";
import type { DatasetColumns } from "../types";
import {
  convertRowsToColumnTypes,
  detectFileFormat,
  parseCSV,
  parseJSON,
  parseJSONL,
  renameReservedColumns,
} from "../upload-utils";

describe("Feature: Dataset File Upload - Upload Utils", () => {
  // ── Format Detection ───────────────────────────────────────────

  describe("detectFileFormat()", () => {
    describe("when given a .csv extension", () => {
      it("detects CSV format", () => {
        expect(detectFileFormat("data.csv")).toBe("csv");
      });
    });

    describe("when given a .json extension", () => {
      it("detects JSON format", () => {
        expect(detectFileFormat("data.json")).toBe("json");
      });
    });

    describe("when given a .jsonl extension", () => {
      it("detects JSONL format", () => {
        expect(detectFileFormat("data.jsonl")).toBe("jsonl");
      });
    });

    describe("when given an unsupported extension", () => {
      it("throws an error for .parquet", () => {
        expect(() => detectFileFormat("data.parquet")).toThrow(
          /unsupported file format/i,
        );
      });

      it("throws an error for .xlsx", () => {
        expect(() => detectFileFormat("data.xlsx")).toThrow(
          /unsupported file format/i,
        );
      });
    });

    describe("when given uppercase extensions", () => {
      it("detects CSV format case-insensitively", () => {
        expect(detectFileFormat("DATA.CSV")).toBe("csv");
      });
    });
  });

  // ── CSV Parsing ────────────────────────────────────────────────

  describe("parseCSV()", () => {
    describe("when given a CSV with headers and 2 data rows", () => {
      it("returns 2 records with correct keys", () => {
        const csv = "a,b\n1,2\n3,4";
        const result = parseCSV(csv);
        expect(result.headers).toEqual(["a", "b"]);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]).toEqual({ a: "1", b: "2" });
        expect(result.rows[1]).toEqual({ a: "3", b: "4" });
      });
    });

    describe("when a value contains a comma inside quotes", () => {
      it("preserves the quoted value as a single field", () => {
        const csv = 'name,description\nAlice,"Hello, World"\nBob,Simple';
        const result = parseCSV(csv);
        expect(result.rows[0]).toEqual({
          name: "Alice",
          description: "Hello, World",
        });
      });
    });

    describe("when given only headers and no data rows", () => {
      it("returns empty rows array", () => {
        const csv = "a,b\n";
        const result = parseCSV(csv);
        expect(result.headers).toEqual(["a", "b"]);
        expect(result.rows).toHaveLength(0);
      });
    });
  });

  // ── JSON Parsing ───────────────────────────────────────────────

  describe("parseJSON()", () => {
    describe("when given a JSON array of 2 objects", () => {
      it("returns 2 records", () => {
        const json = '[{"name": "Alice"}, {"name": "Bob"}]';
        const result = parseJSON(json);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ name: "Alice" });
        expect(result[1]).toEqual({ name: "Bob" });
      });
    });

    describe("when given invalid JSON", () => {
      it("throws an error", () => {
        expect(() => parseJSON("not json")).toThrow();
      });
    });

    describe("when given a non-array JSON", () => {
      it("throws an error", () => {
        expect(() => parseJSON('{"name": "Alice"}')).toThrow(
          /must be an array/i,
        );
      });
    });
  });

  // ── JSONL Parsing ──────────────────────────────────────────────

  describe("parseJSONL()", () => {
    describe("when given 3 lines of JSONL", () => {
      it("returns 3 records", () => {
        const jsonl =
          '{"a": 1}\n{"a": 2}\n{"a": 3}';
        const result = parseJSONL(jsonl);
        expect(result).toHaveLength(3);
      });
    });

    describe("when blank lines exist between objects", () => {
      it("skips blank lines and returns only valid objects", () => {
        const jsonl = '{"a": 1}\n\n{"a": 2}\n\n';
        const result = parseJSONL(jsonl);
        expect(result).toHaveLength(2);
      });
    });

    describe("when the content is a valid JSON array (fallback)", () => {
      it("parses as JSON array first", () => {
        const content = '[{"a": 1}, {"a": 2}]';
        const result = parseJSONL(content);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ a: 1 });
      });
    });

    describe("when content is not valid JSON but is valid JSONL", () => {
      it("successfully parses as JSONL", () => {
        const content = '{"a": 1}\n{"a": 2}';
        const result = parseJSONL(content);
        expect(result).toHaveLength(2);
      });
    });
  });

  // ── Reserved Column Renaming ───────────────────────────────────

  describe("renameReservedColumns()", () => {
    describe("when columns include 'id'", () => {
      it("renames 'id' to 'id_'", () => {
        const result = renameReservedColumns(["id", "name"]);
        expect(result).toEqual(["id_", "name"]);
      });
    });

    describe("when columns include 'selected'", () => {
      it("renames 'selected' to 'selected_'", () => {
        const result = renameReservedColumns(["selected", "value"]);
        expect(result).toEqual(["selected_", "value"]);
      });
    });

    describe("when columns have no reserved names", () => {
      it("returns columns unchanged", () => {
        const result = renameReservedColumns(["input", "output"]);
        expect(result).toEqual(["input", "output"]);
      });
    });

    describe("when both 'id' and 'selected' are present", () => {
      it("renames both", () => {
        const result = renameReservedColumns(["id", "selected", "data"]);
        expect(result).toEqual(["id_", "selected_", "data"]);
      });
    });
  });

  // ── Type Conversion ────────────────────────────────────────────

  describe("convertRowsToColumnTypes()", () => {
    describe("when converting string values to numbers", () => {
      it("converts numeric strings to numbers", () => {
        const columns: DatasetColumns = [
          { name: "count", type: "number" },
        ];
        const rows = [{ count: "42" }, { count: "3.14" }];
        const result = convertRowsToColumnTypes(rows, columns);
        expect(result[0]!.count).toBe(42);
        expect(result[1]!.count).toBe(3.14);
      });

      it("converts empty values to null", () => {
        const columns: DatasetColumns = [
          { name: "count", type: "number" },
        ];
        const rows = [{ count: "" }];
        const result = convertRowsToColumnTypes(rows, columns);
        expect(result[0]!.count).toBeNull();
      });
    });

    describe("when converting string values to booleans", () => {
      it("converts truthy strings to true", () => {
        const columns: DatasetColumns = [
          { name: "active", type: "boolean" },
        ];
        const rows = [
          { active: "true" },
          { active: "1" },
          { active: "yes" },
        ];
        const result = convertRowsToColumnTypes(rows, columns);
        expect(result[0]!.active).toBe(true);
        expect(result[1]!.active).toBe(true);
        expect(result[2]!.active).toBe(true);
      });

      it("converts falsy strings to false", () => {
        const columns: DatasetColumns = [
          { name: "active", type: "boolean" },
        ];
        const rows = [
          { active: "false" },
          { active: "0" },
          { active: "no" },
        ];
        const result = convertRowsToColumnTypes(rows, columns);
        expect(result[0]!.active).toBe(false);
        expect(result[1]!.active).toBe(false);
        expect(result[2]!.active).toBe(false);
      });
    });

    describe("when converting string values to dates", () => {
      it("converts valid date strings to ISO date format", () => {
        const columns: DatasetColumns = [
          { name: "created", type: "date" },
        ];
        const rows = [{ created: "2024-01-15" }];
        const result = convertRowsToColumnTypes(rows, columns);
        expect(result[0]!.created).toBe("2024-01-15");
      });
    });

    describe("when converting string values to JSON", () => {
      it("parses JSON strings", () => {
        const columns: DatasetColumns = [
          { name: "meta", type: "json" },
        ];
        const rows = [{ meta: '{"key": "value"}' }];
        const result = convertRowsToColumnTypes(rows, columns);
        expect(result[0]!.meta).toEqual({ key: "value" });
      });
    });

    describe("when column type is string", () => {
      it("leaves values unchanged", () => {
        const columns: DatasetColumns = [
          { name: "text", type: "string" },
        ];
        const rows = [{ text: "hello" }];
        const result = convertRowsToColumnTypes(rows, columns);
        expect(result[0]!.text).toBe("hello");
      });
    });
  });
});
