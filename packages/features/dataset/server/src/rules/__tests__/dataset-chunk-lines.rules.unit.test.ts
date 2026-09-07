/**
 * The arithmetic and shape rules a chunked dataset's writes depend on: every row carries a
 * unique id, the offset index is the running sum of prior chunks, and a dataset that is not
 * ready is never mutated.
 */
import { describe, expect, it } from "vitest";
import { DatasetNotReadyError, DuplicateRecordIdError } from "@langwatch/dataset-contract";
import {
  assertReady,
  isChunkLine,
  mapPreviousColumnsToNewColumns,
  readOffsets,
  recomputeOffsets,
  toChunkLines,
} from "../dataset-chunk-lines.rules.ts";

describe("toChunkLines", () => {
  describe("when no ids are forced", () => {
    it("mints a record id per entry", () => {
      const lines = toChunkLines([{ text: "a" }]);

      expect(lines).toHaveLength(1);
      expect(lines[0]!.id.startsWith("record_")).toBe(true);
      expect(lines[0]!.entry).toEqual({ text: "a" });
    });
  });

  describe("when the caller pins the ids", () => {
    it("uses each forced id in order", () => {
      const lines = toChunkLines([{ a: 1 }, { a: 2 }], { forcedIds: ["one", "two"] });

      expect(lines.map((line) => line.id)).toEqual(["one", "two"]);
    });
  });

  describe("when two forced ids collide within the batch", () => {
    it("refuses rather than writing a ghost row", () => {
      expect(() => toChunkLines([{ a: 1 }, { a: 2 }], { forcedIds: ["same", "same"] })).toThrow(
        DuplicateRecordIdError,
      );
    });
  });
});

describe("isChunkLine", () => {
  it("accepts a row carrying both an id and an entry", () => {
    expect(isChunkLine({ id: "one", entry: {} })).toBe(true);
  });

  it("rejects a bare row, a null and a primitive", () => {
    expect(isChunkLine({ entry: {} })).toBe(false);
    expect(isChunkLine(null)).toBe(false);
    expect(isChunkLine("row")).toBe(false);
  });
});

describe("readOffsets", () => {
  it("reads back a stored offset array", () => {
    const offsets = [{ index: 0, startRow: 0, endRow: 2, byteSize: 10 }];

    expect(readOffsets({ chunkOffsets: offsets })).toEqual(offsets);
  });

  describe("when the column is null or a legacy non-array value", () => {
    it("defaults to no offsets rather than throwing", () => {
      expect(readOffsets({ chunkOffsets: null })).toEqual([]);
      expect(readOffsets({ chunkOffsets: { legacy: true } })).toEqual([]);
    });
  });
});

describe("assertReady", () => {
  it("passes a ready dataset through", () => {
    expect(() => assertReady({ status: "ready", statusError: null })).not.toThrow();
  });

  describe("when the dataset is still preparing or failed", () => {
    it("refuses with the status it was in", () => {
      let thrown: unknown;
      try {
        assertReady({ status: "failed", statusError: "boom" });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(DatasetNotReadyError);
    });
  });
});

describe("recomputeOffsets", () => {
  it("makes each chunk start where the previous one ended and totals the bytes", () => {
    expect(
      recomputeOffsets([
        { rowCount: 2, byteSize: 10 },
        { rowCount: 3, byteSize: 20 },
      ]),
    ).toEqual({
      offsets: [
        { index: 0, startRow: 0, endRow: 2, byteSize: 10 },
        { index: 1, startRow: 2, endRow: 5, byteSize: 20 },
      ],
      rowCount: 5,
      sizeBytes: 30,
    });
  });

  describe("when a chunk was emptied", () => {
    it("keeps its entry with an empty row span so the index stays contiguous", () => {
      const { offsets, rowCount } = recomputeOffsets([
        { rowCount: 0, byteSize: 0 },
        { rowCount: 1, byteSize: 5 },
      ]);

      expect(offsets[0]).toEqual({ index: 0, startRow: 0, endRow: 0, byteSize: 0 });
      expect(offsets[1]).toEqual({ index: 1, startRow: 0, endRow: 1, byteSize: 5 });
      expect(rowCount).toBe(1);
    });
  });
});

describe("mapPreviousColumnsToNewColumns", () => {
  const column = (name: string) => ({ name, type: "string" as const });

  describe("when a column keeps its name", () => {
    it("carries its values across unchanged", () => {
      expect(
        mapPreviousColumnsToNewColumns(
          [{ input: "a", output: "b" }],
          [column("input"), column("output")],
          [column("input"), column("output")],
        ),
      ).toEqual([{ input: "a", output: "b" }]);
    });
  });

  describe("when a column was renamed", () => {
    it("moves its values onto the new name by position among the unmatched columns", () => {
      expect(
        mapPreviousColumnsToNewColumns(
          [{ input: "a", old: "b" }],
          [column("input"), column("old")],
          [column("input"), column("renamed")],
        ),
      ).toEqual([{ input: "a", renamed: "b" }]);
    });
  });

  describe("when a column was dropped", () => {
    it("leaves its values out of the remapped row", () => {
      expect(
        mapPreviousColumnsToNewColumns(
          [{ id: "record-1", input: "a", gone: "b" }],
          [column("input"), column("gone")],
          [column("input")],
        ),
      ).toEqual([{ id: "record-1", input: "a" }]);
    });
  });
});
