import { describe, expect, it } from "vitest";
import { decodeWireRows } from "../wire-rows";

describe("given decodeWireRows()", () => {
  describe("when the result carries names and ordinary types", () => {
    it("rebuilds one object per row, keyed by column name", () => {
      const rows = decodeWireRows<{ TenantId: string; Name: string }>({
        header: { names: ["TenantId", "Name"], types: ["String", "String"] },
        rows: [
          ["project-1", "alpha"],
          ["project-1", "beta"],
        ],
      });

      expect(rows).toEqual([
        { TenantId: "project-1", Name: "alpha" },
        { TenantId: "project-1", Name: "beta" },
      ]);
    });
  });

  describe("when a column is declared as a 64-bit integer", () => {
    it("converts the quoted cell back to a number, as the driver path returned it", () => {
      const rows = decodeWireRows<{ Count: number }>({
        header: { names: ["Count"], types: ["UInt64"] },
        rows: [["42"]],
      });

      expect(rows).toEqual([{ Count: 42 }]);
    });

    it("converts through Nullable and LowCardinality wrappers", () => {
      const rows = decodeWireRows<{ A: number | null; B: number }>({
        header: {
          names: ["A", "B"],
          types: ["Nullable(UInt64)", "LowCardinality(Nullable(Int64))"],
        },
        rows: [
          ["7", "-9"],
          [null, "0"],
        ],
      });

      expect(rows).toEqual([
        { A: 7, B: -9 },
        { A: null, B: 0 },
      ]);
    });

    it("converts every element of an array of 64-bit integers", () => {
      const rows = decodeWireRows<{ Buckets: number[] }>({
        header: { names: ["Buckets"], types: ["Array(UInt64)"] },
        rows: [[["1", "2", "3"]]],
      });

      expect(rows).toEqual([{ Buckets: [1, 2, 3] }]);
    });
  });

  describe("when a String column happens to hold digits", () => {
    it("leaves it a string, because the header and not the value decides", () => {
      const rows = decodeWireRows<{ TraceId: string }>({
        header: { names: ["TraceId"], types: ["String"] },
        rows: [["1234567890123456789"]],
      });

      expect(rows).toEqual([{ TraceId: "1234567890123456789" }]);
    });
  });

  describe("when a 32-bit integer column arrives unquoted", () => {
    it("passes the number through untouched", () => {
      const rows = decodeWireRows<{ Total: number }>({
        header: { names: ["Total"], types: ["UInt32"] },
        rows: [[5]],
      });

      expect(rows).toEqual([{ Total: 5 }]);
    });
  });

  describe("when the result has rows but no header", () => {
    it("throws rather than reporting the rows as absent", () => {
      expect(() => decodeWireRows({ rows: [["a"]] })).toThrow(/column header/);
    });
  });

  describe("when the result is empty", () => {
    it("returns an empty list without needing a header", () => {
      expect(decodeWireRows({ rows: [] })).toEqual([]);
    });
  });
});
