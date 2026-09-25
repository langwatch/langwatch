import { describe, expect, it } from "vitest";
import {
  chunkedMeta,
  chunkKey,
  readValidChunkOffsets,
  toJsonlChunks,
} from "../dataset-chunking";

describe("toJsonlChunks", () => {
  describe("given records that fit under the cap", () => {
    it("emits a single chunk with every row in order", () => {
      const records = [{ i: 0 }, { i: 1 }, { i: 2 }];
      const chunks = toJsonlChunks(records, { maxBytes: 1000 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.rowCount).toBe(3);
      expect(chunks[0]!.startRow).toBe(0);
      expect(chunks[0]!.endRow).toBe(3);
      expect(chunks[0]!.jsonl).toBe('{"i":0}\n{"i":1}\n{"i":2}\n');
      expect(chunks[0]!.byteSize).toBe(
        Buffer.byteLength(chunks[0]!.jsonl, "utf8"),
      );
    });
  });

  describe("given records that exceed the cap", () => {
    it("rolls over to a new chunk at the boundary, preserving order and contiguous offsets", () => {
      const records = [{ i: 0 }, { i: 1 }, { i: 2 }];
      // each line is {"i":N}\n = 8 bytes; cap of 20 holds two rows per chunk
      const chunks = toJsonlChunks(records, { maxBytes: 20 });

      expect(chunks).toHaveLength(2);
      expect(chunks[0]!.rowCount).toBe(2);
      expect(chunks[0]!.startRow).toBe(0);
      expect(chunks[0]!.endRow).toBe(2);
      expect(chunks[1]!.rowCount).toBe(1);
      expect(chunks[1]!.startRow).toBe(2);
      expect(chunks[1]!.endRow).toBe(3);
      expect(chunks[1]!.index).toBe(1);
    });
  });

  describe("given a single row larger than the cap", () => {
    it("still emits that row in its own chunk instead of dropping it", () => {
      const records = [{ big: "x".repeat(500) }];
      const chunks = toJsonlChunks(records, { maxBytes: 2 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.rowCount).toBe(1);
    });
  });

  describe("given a value containing a null byte", () => {
    it("scrubs U+0000 before serializing (Postgres-parity)", () => {
      const chunks = toJsonlChunks([{ a: "x\u0000y" }]);

      expect(chunks[0]!.jsonl).toContain('"a":"xy"');
      expect(chunks[0]!.jsonl.includes("\u0000")).toBe(false);
    });
  });

  describe("given no records", () => {
    it("emits no chunks", () => {
      expect(toJsonlChunks([])).toHaveLength(0);
    });
  });
});

describe("chunkedMeta", () => {
  describe("when aggregating a multi-chunk dataset", () => {
    it("sums rows and bytes and reports per-chunk offsets", () => {
      const records = [{ i: 0 }, { i: 1 }, { i: 2 }];
      const chunks = toJsonlChunks(records, { maxBytes: 20 });
      const meta = chunkedMeta(chunks);

      expect(meta.rowCount).toBe(3);
      expect(meta.chunkCount).toBe(2);
      expect(meta.sizeBytes).toBe(chunks.reduce((n, c) => n + c.byteSize, 0));
      expect(meta.chunkOffsets).toEqual([
        { index: 0, startRow: 0, endRow: 2, byteSize: chunks[0]!.byteSize },
        { index: 1, startRow: 2, endRow: 3, byteSize: chunks[1]!.byteSize },
      ]);
    });
  });
});

describe("chunkKey", () => {
  describe("when building a chunk key", () => {
    it("is tenant-prefixed, ordered and zero-padded", () => {
      expect(chunkKey("proj1", "ds1", 0)).toBe(
        "datasets/proj1/ds1/chunk-00000.jsonl",
      );
      expect(chunkKey("proj1", "ds1", 42)).toBe(
        "datasets/proj1/ds1/chunk-00042.jsonl",
      );
    });
  });
});

describe("readValidChunkOffsets", () => {
  const contiguous = [
    { index: 0, startRow: 0, endRow: 2, byteSize: 10 },
    { index: 1, startRow: 2, endRow: 4, byteSize: 10 },
  ];

  describe("given a well-formed index", () => {
    it("returns it unchanged", () => {
      expect(readValidChunkOffsets(contiguous)).toEqual(contiguous);
    });
  });

  describe("given two entries naming the same chunk", () => {
    it("rejects the whole index rather than let the readers disagree", () => {
      // The two readers of this array key off different parts of it, so a
      // duplicate index makes the same dataset answer two ways. Paging selects
      // entries by row range and reads the `index` each one names, so it
      // fetches chunk 0 twice — once as rows 0-1 and again as rows 2-3 — and
      // never reads chunk 1 at all. A search deduplicates the indexes, so it
      // reads chunk 0 once and finds no trace of the rows the grid is showing.
      // Neither is right, and the disagreement is the part a user cannot
      // explain: the row is on screen and the search says there is no match.
      expect(
        readValidChunkOffsets([
          { index: 0, startRow: 0, endRow: 2, byteSize: 10 },
          { index: 0, startRow: 2, endRow: 4, byteSize: 10 },
        ]),
      ).toEqual([]);
    });
  });

  describe("given an entry naming a chunk that cannot exist", () => {
    it("rejects the whole index rather than ask storage for it", () => {
      // Chunk keys are built by zero-padding the index, so a negative one
      // addresses no object. `Number.isInteger` lets it through, the read comes
      // back empty, and the rows of that chunk go silently missing from a
      // dataset that still reports having them.
      expect(
        readValidChunkOffsets([
          { index: -1, startRow: 0, endRow: 2, byteSize: 10 },
          { index: 1, startRow: 2, endRow: 4, byteSize: 10 },
        ]),
      ).toEqual([]);
    });
  });
});
