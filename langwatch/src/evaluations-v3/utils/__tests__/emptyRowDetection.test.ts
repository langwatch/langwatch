import { describe, it, expect } from "vitest";
import {
  isRowEmpty,
  getNonEmptyRowIndices,
  filterEmptyRows,
} from "../emptyRowDetection";

describe("isRowEmpty", () => {
  it("returns true for completely empty object", () => {
    expect(isRowEmpty({})).toBe(true);
  });

  it("returns true when all values are empty strings", () => {
    expect(isRowEmpty({ input: "", output: "" })).toBe(true);
  });

  it("returns true when all values are whitespace-only strings", () => {
    expect(isRowEmpty({ input: "   ", output: "\t\n" })).toBe(true);
  });

  it("returns true when all values are null", () => {
    expect(isRowEmpty({ input: null, output: null })).toBe(true);
  });

  it("returns true when all values are undefined", () => {
    expect(isRowEmpty({ input: undefined, output: undefined })).toBe(true);
  });

  it("returns true for mixed empty values", () => {
    expect(isRowEmpty({ input: "", output: null, expected: "   " })).toBe(true);
  });

  it("returns false when at least one value has content", () => {
    expect(isRowEmpty({ input: "hello", output: "" })).toBe(false);
  });

  it("returns false for non-empty string values", () => {
    expect(isRowEmpty({ input: "hello", output: "world" })).toBe(false);
  });

  it("returns false for numeric values (including 0)", () => {
    expect(isRowEmpty({ value: 0 })).toBe(false);
    expect(isRowEmpty({ value: 42 })).toBe(false);
  });

  it("returns false for boolean values (including false)", () => {
    expect(isRowEmpty({ flag: false })).toBe(false);
    expect(isRowEmpty({ flag: true })).toBe(false);
  });

  it("ignores internal fields starting with underscore", () => {
    // Row with only internal fields is considered empty
    expect(isRowEmpty({ _id: "123", _datasetId: "ds1" })).toBe(true);
    // But if there's a non-internal empty field, still empty
    expect(isRowEmpty({ _id: "123", input: "" })).toBe(true);
    // If non-internal field has content, not empty
    expect(isRowEmpty({ _id: "123", input: "hello" })).toBe(false);
  });

  it("ignores id and selected fields (common metadata fields)", () => {
    // Row with only id is considered empty
    expect(isRowEmpty({ id: "abc123" })).toBe(true);
    // Row with id and selected is considered empty
    expect(isRowEmpty({ id: "abc123", selected: true })).toBe(true);
    // Row with id but other empty fields is still empty
    expect(isRowEmpty({ id: "abc123", input: "", output: "" })).toBe(true);
    // Row with id and non-empty content is not empty
    expect(isRowEmpty({ id: "abc123", input: "hello" })).toBe(false);
    // Mixed internal fields
    expect(isRowEmpty({ id: "abc123", _datasetId: "ds1", input: "", expected: "" })).toBe(true);
    expect(isRowEmpty({ id: "abc123", _datasetId: "ds1", input: "test", expected: "" })).toBe(false);
  });

  it("returns false for arrays (even empty ones)", () => {
    expect(isRowEmpty({ items: [] })).toBe(false);
    expect(isRowEmpty({ items: ["a", "b"] })).toBe(false);
  });

  it("returns false for objects (even empty ones)", () => {
    expect(isRowEmpty({ nested: {} })).toBe(false);
  });
});

describe("getNonEmptyRowIndices", () => {
  it("returns empty array for empty dataset", () => {
    expect(getNonEmptyRowIndices([])).toEqual([]);
  });

  it("returns empty array when all rows are empty", () => {
    const rows = [
      { input: "", output: "" },
      { input: null, output: null },
      { input: "   ", output: "" },
    ];
    expect(getNonEmptyRowIndices(rows)).toEqual([]);
  });

  it("returns all indices when no rows are empty", () => {
    const rows = [
      { input: "a", output: "b" },
      { input: "c", output: "d" },
      { input: "e", output: "f" },
    ];
    expect(getNonEmptyRowIndices(rows)).toEqual([0, 1, 2]);
  });

  it("returns only non-empty row indices", () => {
    const rows = [
      { input: "hello", output: "" },      // index 0: non-empty
      { input: "", output: "" },           // index 1: empty
      { input: "", output: "world" },      // index 2: non-empty
      { input: "", output: null },         // index 3: empty
      { input: "test", output: "data" },   // index 4: non-empty
    ];
    expect(getNonEmptyRowIndices(rows)).toEqual([0, 2, 4]);
  });
});

describe("filterEmptyRows", () => {
  it("returns empty array for empty dataset", () => {
    expect(filterEmptyRows([])).toEqual([]);
  });

  it("filters out empty rows and preserves original indices", () => {
    const rows = [
      { input: "hello", output: "" },      // index 0: non-empty
      { input: "", output: "" },           // index 1: empty (filtered)
      { input: "", output: "world" },      // index 2: non-empty
    ];

    const result = filterEmptyRows(rows);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ row: rows[0], originalIndex: 0 });
    expect(result[1]).toEqual({ row: rows[2], originalIndex: 2 });
  });

  it("preserves all rows when none are empty", () => {
    const rows = [
      { input: "a", output: "b" },
      { input: "c", output: "d" },
    ];

    const result = filterEmptyRows(rows);

    expect(result).toHaveLength(2);
    expect(result[0]?.originalIndex).toBe(0);
    expect(result[1]?.originalIndex).toBe(1);
  });
});
