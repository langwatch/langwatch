import { describe, expect, it } from "vitest";
import {
  createRowCodec,
  WireShapeMismatchError,
  type AnyWireColumn,
  type WireColumn,
} from "./rowCodec.js";

const idColumn: WireColumn<string> = {
  chType: "String",
  decode: (raw) => String(raw),
  encode: (value) => value,
};

const countColumn: WireColumn<number> = {
  chType: "Int64",
  decode: (raw) => Number(raw),
  encode: (value) => value,
};

const columnNames = ["id", "count"] as const;
// No cast: a list of concretely-typed columns is exactly what a caller builds,
// so if this needed one, every real call site would need one too.
const columns: readonly AnyWireColumn[] = [idColumn, countColumn];

describe("given a row codec", () => {
  describe("when decoding a matching header and row", () => {
    it("round-trips a row through decode and encode", () => {
      const codec = createRowCodec();
      const header = { names: ["id", "count"], types: ["String", "Int64"] };

      const [decoded] = codec.decodeRows<{ id: string; count: number }>({
        columns,
        columnNames,
        header,
        rows: [["trace-1", "3"]],
      });

      expect(decoded).toEqual({ id: "trace-1", count: 3 });

      const encoded = codec.encodeRows({
        columns,
        columnNames,
        rows: [decoded!],
      });

      expect(encoded).toEqual([["trace-1", 3]]);
    });
  });

  describe("when the header reorders the declared columns", () => {
    it("rejects a header naming the same columns in a different order", () => {
      const codec = createRowCodec();
      const header = { names: ["count", "id"], types: ["Int64", "String"] };

      expect(() =>
        codec.decodeRows({
          columns,
          columnNames,
          header,
          rows: [["trace-1", "3"]],
        })
      ).toThrow(WireShapeMismatchError);
    });
  });

  describe("when the header declares a different type for a column", () => {
    it("rejects the mismatch and names both the declared and server type", () => {
      const codec = createRowCodec();
      const header = { names: ["id", "count"], types: ["String", "UInt64"] };

      expect(() =>
        codec.decodeRows({
          columns,
          columnNames,
          header,
          rows: [["trace-1", "3"]],
        })
      ).toThrow(/"Int64".*"UInt64"/);
    });
  });

  describe("when a row is shorter than the declared columns", () => {
    it("throws instead of decoding trailing columns as undefined", () => {
      const codec = createRowCodec();

      expect(() =>
        codec.decodeRows({
          columns,
          columnNames,
          header: undefined,
          rows: [["trace-1"]],
        })
      ).toThrow(WireShapeMismatchError);
    });
  });

  describe("when no header is present", () => {
    it("tolerates a missing header for write-shaped input", () => {
      const codec = createRowCodec();

      const [decoded] = codec.decodeRows<{ id: string; count: number }>({
        columns,
        columnNames,
        header: undefined,
        rows: [["trace-2", "7"]],
      });

      expect(decoded).toEqual({ id: "trace-2", count: 7 });
    });
  });

  describe("when encoding rows for a write", () => {
    it("emits values in declaration order regardless of object key order", () => {
      const codec = createRowCodec();

      const encoded = codec.encodeRows({
        columns,
        columnNames,
        rows: [{ count: 42, id: "trace-3" }],
      });

      expect(encoded).toEqual([["trace-3", 42]]);
    });
  });
});
