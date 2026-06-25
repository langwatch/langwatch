import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toJsonlChunks } from "../dataset-chunking";
import { createDatasetNormalizeHandler } from "../dataset-normalize.job";

/**
 * Unit test the normalize handler at its boundaries: a fake `DatasetStorage`
 * (streamStaged → Readable.from(...), writeChunks / deleteStaged /
 * deleteChunksFrom spies) and a stub `DatasetRepository`. The streaming parse +
 * chunk-writer logic under test stays real.
 */

const makeStorage = (overrides: Record<string, unknown> = {}) => {
  const writeChunks = vi.fn(
    async ({
      records,
      fromIndex = 0,
    }: {
      records: unknown[];
      fromIndex?: number;
    }) =>
      toJsonlChunks(records).map((c) => ({ ...c, index: c.index + fromIndex })),
  );
  const deleteStaged = vi.fn().mockResolvedValue(undefined);
  const deleteChunksFrom = vi.fn().mockResolvedValue(undefined);
  const headStagedObjectSize = vi.fn().mockResolvedValue(1024);
  return {
    storage: {
      writeChunks,
      deleteStaged,
      deleteChunksFrom,
      headStagedObjectSize,
      streamStaged: vi.fn(),
      readChunks: vi.fn(),
      createPresignedUpload: vi.fn(),
      ...overrides,
    },
    writeChunks,
    deleteStaged,
    deleteChunksFrom,
    headStagedObjectSize,
  };
};

const makeRepo = (dataset: Record<string, unknown> | null) => ({
  findOne: vi.fn().mockResolvedValue(dataset),
  update: vi.fn().mockResolvedValue({}),
});

const basePayload = {
  id: "d1",
  tenantId: "p1",
  projectId: "p1",
  datasetId: "d1",
  stagingKey: "staging/p1/u1",
  filename: "data.jsonl",
};

beforeEach(() => vi.clearAllMocks());

describe("createDatasetNormalizeHandler()", () => {
  describe("when a processing JSONL dataset normalizes successfully", () => {
    it("writes chunks and flips the dataset to ready with counters and columnTypes", async () => {
      const { storage, writeChunks, deleteStaged } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(
            Readable.from(['{"a":"1","b":"x"}\n{"a":"2","b":"y"}\n']),
          ),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      expect(writeChunks).toHaveBeenCalledTimes(1);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("ready");
      expect(update.data.rowCount).toBe(2);
      expect(update.data.chunkCount).toBe(1);
      expect(update.data.columnTypes).toEqual([
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ]);
      expect(typeof update.data.sizeBytes).toBe("bigint");
      expect(deleteStaged).toHaveBeenCalledWith({
        projectId: "p1",
        key: "staging/p1/u1",
      });
    });
  });

  describe("when a CSV dataset normalizes successfully", () => {
    it("derives headers from the CSV fields and writes the rows", async () => {
      const { storage, writeChunks } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(Readable.from(["a,b\n1,x\n2,y\n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler({ ...basePayload, filename: "data.csv" });

      expect(writeChunks).toHaveBeenCalledTimes(1);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("ready");
      expect(update.data.rowCount).toBe(2);
      expect(update.data.columnTypes).toEqual([
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ]);
    });
  });

  describe("when a streamed CSV has two columns sharing a value", () => {
    // @regression — under pause/resume backpressure, header:true made papaparse
    // re-run its duplicate-header dedup against each DATA row, suffixing the
    // second of two equal cells with `_1` (answer == expected_answer, or two
    // blank cells) and warning per row. Deliver the CSV in many small pieces so
    // the parser actually streams — a single-string Readable doesn't trigger it.
    it("never corrupts the second equal cell with a _1 suffix", async () => {
      const rowCount = 200;
      const csv =
        "question,answer,expected_answer\n" +
        Array.from(
          { length: rowCount },
          (_, i) => `"q${i}","Plants oxygen ${i}","Plants oxygen ${i}"`,
        ).join("\n") +
        "\n";
      const pieces = csv.match(/[\s\S]{1,64}/g)!;

      const { storage, writeChunks } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from(pieces)),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });
      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await handler({ ...basePayload, filename: "data.csv" });

      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("ready");
      expect(update.data.rowCount).toBe(rowCount);
      expect(update.data.columnTypes).toEqual([
        { name: "question", type: "string" },
        { name: "answer", type: "string" },
        { name: "expected_answer", type: "string" },
      ]);

      const entries = writeChunks.mock.calls
        .flatMap((call: any) => call[0].records)
        .map((record: any) => record.entry as Record<string, string>);
      expect(entries).toHaveLength(rowCount);
      // Every row's expected_answer is its answer verbatim — never `..._1`.
      for (const entry of entries) {
        expect(entry.expected_answer).toBe(entry.answer);
        expect(entry.expected_answer).not.toMatch(/_1$/);
      }
    });
  });

  describe("when a ready dataset reports its row count and size", () => {
    it("records the true rowCount and a positive sizeBytes once ready", async () => {
      const rows = Array.from({ length: 50 }, (_, i) => `{"a":"${i}"}`).join(
        "\n",
      );
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([rows + "\n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("ready");
      expect(update.data.rowCount).toBe(50);
      expect(update.data.sizeBytes).toBeGreaterThan(0n);
    });
  });

  describe("when the input spans more than one chunk", () => {
    it("writes more than one chunk object keeping memory bounded", async () => {
      const rows = [
        `{"v":"${"x".repeat(50)}"}`,
        `{"v":"${"y".repeat(50)}"}`,
        `{"v":"${"z".repeat(50)}"}`,
      ].join("\n");
      // A tiny per-call chunk cap forces the writer's single flush to split the
      // buffer into multiple chunk objects — proving the chunk-writer yields >1
      // chunk for input larger than one chunk (the streaming, memory-bounded
      // behaviour the handler depends on).
      const splittingWriteChunks = vi.fn(
        async ({ records, fromIndex = 0 }: any) =>
          toJsonlChunks(records, { maxBytes: 10 }).map((c) => ({
            ...c,
            index: c.index + fromIndex,
          })),
      );
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([rows + "\n"])),
        writeChunks: splittingWriteChunks,
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      expect(update.data.rowCount).toBe(3);
      expect(update.data.chunkCount).toBeGreaterThan(1);
      expect(splittingWriteChunks).toHaveBeenCalled();
    });
  });

  // @regression P1#1 — the streaming writer must accumulate ONLY lightweight
  // per-chunk metadata after each flush, never the chunk `jsonl` payloads
  // (I-MEM). A 2–5 GB upload would otherwise hoard the whole normalized file in
  // heap by finalize. Heap proxy: the meta the handler persists carries chunk
  // offsets (metadata) and NO `jsonl` field anywhere, and the counts still match.
  describe("when the input spans many chunks (memory contract)", () => {
    it("persists chunk metadata only — no jsonl payloads retained — with matching counts", async () => {
      const rows = Array.from(
        { length: 6 },
        (_, i) => `{"v":"${String(i).repeat(40)}"}`,
      ).join("\n");
      // Tiny per-flush cap so the single flush splits into several chunk objects.
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([rows + "\n"])),
        writeChunks: vi.fn(async ({ records, fromIndex = 0 }: any) =>
          toJsonlChunks(records, { maxBytes: 10 }).map((c) => ({
            ...c,
            index: c.index + fromIndex,
          })),
        ),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      // Counts still correct.
      expect(update.data.rowCount).toBe(6);
      expect(update.data.chunkCount).toBeGreaterThan(1);
      // Metadata persisted; NO `jsonl` payload anywhere in what the handler kept.
      const offsets = update.data.chunkOffsets as Array<
        Record<string, unknown>
      >;
      expect(offsets).toHaveLength(update.data.chunkCount);
      for (const offset of offsets) {
        expect(offset).not.toHaveProperty("jsonl");
        expect(offset).toMatchObject({
          index: expect.any(Number),
          startRow: expect.any(Number),
          endRow: expect.any(Number),
          byteSize: expect.any(Number),
        });
      }
      // The whole persisted payload must not carry any serialized chunk body
      // (BigInt-safe stringify since `sizeBytes` is a bigint).
      const serialized = JSON.stringify(update.data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      expect(serialized).not.toContain("jsonl");
    });
  });

  describe("when parsing fails", () => {
    it("flips the dataset to failed with a statusError, does NOT delete staging, and rethrows", async () => {
      const { storage, deleteStaged } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(Readable.from(["{not valid json\n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(handler(basePayload)).rejects.toThrow();
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
      expect(update.data.statusError).toBeTruthy();
      expect(deleteStaged).not.toHaveBeenCalled();
    });

    // @regression — a parse error AFTER chunks have already flushed to S3 must
    // reap those chunks. parseInto flushes chunk objects mid-stream, so a
    // failure at a later row leaves chunk-0..k orphaned; chunk keys have no
    // lifecycle TTL, so a permanently-failed dataset would leak them forever.
    describe("when chunks were already flushed before the parse error", () => {
      it("reaps every flushed chunk (deleteChunksFrom 0), keeps staging, and rethrows", async () => {
        // Three ~6 MB valid rows accumulate past CHUNK_MAX_BYTES (16 MB),
        // forcing a real mid-stream flush (writeChunks → chunk objects in S3),
        // then a malformed line throws — the orphan scenario, made concrete.
        const big = (c: string) => `{"v":"${c.repeat(6 * 1024 * 1024)}"}\n`;
        const { storage, writeChunks, deleteStaged, deleteChunksFrom } =
          makeStorage({
            streamStaged: vi
              .fn()
              .mockResolvedValue(
                Readable.from([
                  big("a"),
                  big("b"),
                  big("c"),
                  "{not valid json\n",
                ]),
              ),
          });
        const repo = makeRepo({ id: "d1", status: "processing" });

        const handler = createDatasetNormalizeHandler({
          repository: repo as any,
          getStorage: async () => storage as any,
        });

        await expect(handler(basePayload)).rejects.toThrow();
        // Chunks really were flushed (orphan risk is real, not hypothetical).
        expect(writeChunks).toHaveBeenCalled();
        // …and the catch reaps them all.
        expect(deleteChunksFrom).toHaveBeenCalledWith({
          projectId: "p1",
          datasetId: "d1",
          fromIndex: 0,
        });
        const update = repo.update.mock.calls[0]![0];
        expect(update.data.status).toBe("failed");
        // Staging preserved for a manual retry; not deleted on failure.
        expect(deleteStaged).not.toHaveBeenCalled();
      });
    });
  });

  describe("when the dataset is not in processing", () => {
    it("no-ops without touching storage (idempotent re-drive guard)", async () => {
      const { storage } = makeStorage({
        streamStaged: vi.fn(),
      });
      const repo = makeRepo({ id: "d1", status: "ready" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      expect(storage.streamStaged).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset row no longer exists", () => {
    it("no-ops", async () => {
      const { storage } = makeStorage({ streamStaged: vi.fn() });
      const repo = makeRepo(null);

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      expect(storage.streamStaged).not.toHaveBeenCalled();
    });
  });

  describe("when a .json file exceeds the large-json cap", () => {
    it("fails the dataset with a convert-to-JSONL statusError", async () => {
      const { storage } = makeStorage({
        headStagedObjectSize: vi.fn().mockResolvedValue(200 * 1024 * 1024),
        streamStaged: vi.fn().mockResolvedValue(Readable.from(["[]"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(
        handler({ ...basePayload, filename: "big.json" }),
      ).rejects.toThrow(/JSONL/i);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
    });
  });

  describe("when a CSV row exceeds the max row size (malformed / no delimiter)", () => {
    it("aborts and fails the dataset instead of buffering the whole file (I-MEM)", async () => {
      // A header + a single data row whose field is larger than MAX_CSV_ROW_BYTES
      // (8 MB). papaparse would buffer the whole thing without the cursor guard;
      // the guard aborts and the handler fails the dataset.
      const giantField = "x".repeat(9 * 1024 * 1024);
      const { storage, deleteStaged } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(Readable.from([`a,b\n1,${giantField}\n`])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(
        handler({ ...basePayload, filename: "malformed.csv" }),
      ).rejects.toThrow(/CSV row exceeds max size/i);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
      // Staging preserved for a manual retry; not deleted on failure.
      expect(deleteStaged).not.toHaveBeenCalled();
    });
  });

  describe("when a record carries a reserved column name", () => {
    it("renames the key in stored rows and columnTypes (id → id_)", async () => {
      const { storage, writeChunks } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(Readable.from(['{"id":"x","b":"y"}\n'])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      // The stored row's keys are rewritten so they match columnTypes. Each
      // line is wrapped as { id, entry } so a later edit/delete can target the
      // row by id.
      const pushed = writeChunks.mock.calls[0]![0].records as Array<{
        id: string;
        entry: Record<string, unknown>;
      }>;
      expect(pushed).toHaveLength(1);
      expect(pushed[0]!.id).toMatch(/^record_/);
      expect(pushed[0]!.entry).toEqual({ id_: "x", b: "y" });
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.columnTypes).toEqual([
        { name: "id_", type: "string" },
        { name: "b", type: "string" },
      ]);
    });
  });

  // ADR-032 v19: the upload confirm step persists user-chosen columns (names +
  // types) on the row. Normalize must honour them — rename keys + convert values
  // streaming — instead of deriving all-`string`.
  describe("when the dataset carries confirmed columnTypes", () => {
    describe("given a JSONL file and a confirmed number + rename", () => {
      /** @scenario The dataset is prepared with the columns I confirmed */
      it("renames keys to the confirmed names and converts values to the confirmed types", async () => {
        const { storage, writeChunks } = makeStorage({
          streamStaged: vi
            .fn()
            .mockResolvedValue(
              Readable.from([
                '{"qty":"5","name":"x"}\n{"qty":"12","name":"y"}\n',
              ]),
            ),
        });
        const repo = makeRepo({
          id: "d1",
          status: "processing",
          // Positionally 1:1 with the canonical headers [qty, name]: rename qty
          // → quantity as a number, keep name as a string.
          columnTypes: [
            { name: "quantity", type: "number" },
            { name: "name", type: "string" },
          ],
        });

        const handler = createDatasetNormalizeHandler({
          repository: repo as any,
          getStorage: async () => storage as any,
        });
        await handler(basePayload);

        const entries = writeChunks.mock.calls
          .flatMap((call: any) => call[0].records)
          .map((record: any) => record.entry as Record<string, unknown>);
        expect(entries).toEqual([
          { quantity: 5, name: "x" },
          { quantity: 12, name: "y" },
        ]);
        const update = repo.update.mock.calls[0]![0];
        expect(update.data.status).toBe("ready");
        // The persisted columnTypes are the confirmed ones, not derived strings.
        expect(update.data.columnTypes).toEqual([
          { name: "quantity", type: "number" },
          { name: "name", type: "string" },
        ]);
      });
    });

    describe("given a CSV file and a confirmed number column", () => {
      it("converts the column's values to numbers as they stream", async () => {
        const { storage, writeChunks } = makeStorage({
          streamStaged: vi
            .fn()
            .mockResolvedValue(Readable.from(["a,b\n1,x\n2,y\n"])),
        });
        const repo = makeRepo({
          id: "d1",
          status: "processing",
          columnTypes: [
            { name: "a", type: "number" },
            { name: "b", type: "string" },
          ],
        });

        const handler = createDatasetNormalizeHandler({
          repository: repo as any,
          getStorage: async () => storage as any,
        });
        await handler({ ...basePayload, filename: "data.csv" });

        const entries = writeChunks.mock.calls
          .flatMap((call: any) => call[0].records)
          .map((record: any) => record.entry as Record<string, unknown>);
        expect(entries).toEqual([
          { a: 1, b: "x" },
          { a: 2, b: "y" },
        ]);
      });
    });

    describe("given a JSON-array file and a confirmed number + rename", () => {
      it("renames keys and converts values the same as the JSONL/CSV paths", async () => {
        const { storage, writeChunks } = makeStorage({
          streamStaged: vi
            .fn()
            .mockResolvedValue(
              Readable.from([
                '[{"qty":"5","name":"x"},{"qty":"12","name":"y"}]',
              ]),
            ),
        });
        const repo = makeRepo({
          id: "d1",
          status: "processing",
          columnTypes: [
            { name: "quantity", type: "number" },
            { name: "name", type: "string" },
          ],
        });

        const handler = createDatasetNormalizeHandler({
          repository: repo as any,
          getStorage: async () => storage as any,
        });
        await handler({ ...basePayload, filename: "data.json" });

        const entries = writeChunks.mock.calls
          .flatMap((call: any) => call[0].records)
          .map((record: any) => record.entry as Record<string, unknown>);
        expect(entries).toEqual([
          { quantity: 5, name: "x" },
          { quantity: 12, name: "y" },
        ]);
        const update = repo.update.mock.calls[0]![0];
        expect(update.data.columnTypes).toEqual([
          { name: "quantity", type: "number" },
          { name: "name", type: "string" },
        ]);
      });
    });

    describe("given confirmed columns reordered in the confirm UI (sourceHeader-bound)", () => {
      // The confirm UI lets the user drag-reorder columns. Each confirmed column
      // carries its immutable `sourceHeader`, so normalize must bind values BY
      // HEADER — never by array position — else a reorder would silently rename
      // every column against the wrong data.
      describe("when columns are reordered", () => {
        it("binds each value by sourceHeader, not position, and persists the user's order", async () => {
          const { storage, writeChunks } = makeStorage({
            streamStaged: vi
              .fn()
              .mockResolvedValue(
                Readable.from([
                  '{"qty":"5","name":"x"}\n{"qty":"12","name":"y"}\n',
                ]),
              ),
          });
          const repo = makeRepo({
            id: "d1",
            status: "processing",
            // File header order is [qty, name], but the user dragged `name` first.
            // Binding by position would map qty's values under `name` — the bug.
            columnTypes: [
              { name: "name", type: "string", sourceHeader: "name" },
              { name: "quantity", type: "number", sourceHeader: "qty" },
            ],
          });

          const handler = createDatasetNormalizeHandler({
            repository: repo as any,
            getStorage: async () => storage as any,
          });
          await handler(basePayload);

          const entries = writeChunks.mock.calls
            .flatMap((call: any) => call[0].records)
            .map((record: any) => record.entry as Record<string, unknown>);
          // qty → quantity:number, name stays a string — each value tracked its
          // own header through the reorder.
          expect(entries).toEqual([
            { quantity: 5, name: "x" },
            { quantity: 12, name: "y" },
          ]);
          const update = repo.update.mock.calls[0]![0];
          // Persisted columnTypes follow the user's drag order, sourceHeader stripped.
          expect(update.data.columnTypes).toEqual([
            { name: "name", type: "string" },
            { name: "quantity", type: "number" },
          ]);
        });
      });

      describe("when columns are renamed and reordered", () => {
        it("handles a simultaneous rename + reorder without scrambling values", async () => {
          const { storage, writeChunks } = makeStorage({
            streamStaged: vi
              .fn()
              .mockResolvedValue(
                Readable.from(['{"first":"a","second":"b"}\n']),
              ),
          });
          const repo = makeRepo({
            id: "d1",
            status: "processing",
            // Both renamed AND reordered relative to the file's [first, second].
            columnTypes: [
              { name: "Second Col", type: "string", sourceHeader: "second" },
              { name: "First Col", type: "string", sourceHeader: "first" },
            ],
          });

          const handler = createDatasetNormalizeHandler({
            repository: repo as any,
            getStorage: async () => storage as any,
          });
          await handler(basePayload);

          const entries = writeChunks.mock.calls
            .flatMap((call: any) => call[0].records)
            .map((record: any) => record.entry as Record<string, unknown>);
          // "a" came from header `first` → "First Col"; "b" from `second` → "Second Col".
          expect(entries).toEqual([{ "First Col": "a", "Second Col": "b" }]);
          const update = repo.update.mock.calls[0]![0];
          expect(update.data.columnTypes).toEqual([
            { name: "Second Col", type: "string" },
            { name: "First Col", type: "string" },
          ]);
        });
      });

      describe("when sourceHeader coverage is incomplete", () => {
        it("degrades to derive-all-string when a sourceHeader does not cover the file headers", async () => {
          // A confirmed column whose sourceHeader matches no file header (count
          // still matches) must not half-rename — fall back, same as a count miss.
          const { storage, writeChunks } = makeStorage({
            streamStaged: vi
              .fn()
              .mockResolvedValue(Readable.from(['{"a":"1","b":"x"}\n'])),
          });
          const repo = makeRepo({
            id: "d1",
            status: "processing",
            columnTypes: [
              { name: "a", type: "number", sourceHeader: "a" },
              { name: "wrong", type: "number", sourceHeader: "nonexistent" },
            ],
          });

          const handler = createDatasetNormalizeHandler({
            repository: repo as any,
            getStorage: async () => storage as any,
          });
          await handler(basePayload);

          const entries = writeChunks.mock.calls
            .flatMap((call: any) => call[0].records)
            .map((record: any) => record.entry as Record<string, unknown>);
          expect(entries).toEqual([{ a: "1", b: "x" }]);
          const update = repo.update.mock.calls[0]![0];
          expect(update.data.columnTypes).toEqual([
            { name: "a", type: "string" },
            { name: "b", type: "string" },
          ]);
        });
      });

      describe("when columns share a duplicate sourceHeader", () => {
        // A confirm payload with the same sourceHeader twice collapses in the
        // header→column map. Binding fewer columns than claimed would persist a
        // half-mapped dataset, so normalize degrades to derive-all-string —
        // exactly like a coverage miss.
        it("degrades to derive-all-string rather than dropping the collision", async () => {
          const { storage, writeChunks } = makeStorage({
            streamStaged: vi
              .fn()
              .mockResolvedValue(Readable.from(['{"a":"1","b":"x"}\n'])),
          });
          const repo = makeRepo({
            id: "d1",
            status: "processing",
            columnTypes: [
              { name: "a", type: "number", sourceHeader: "a" },
              { name: "b", type: "number", sourceHeader: "a" },
            ],
          });

          const handler = createDatasetNormalizeHandler({
            repository: repo as any,
            getStorage: async () => storage as any,
          });
          await handler(basePayload);

          const entries = writeChunks.mock.calls
            .flatMap((call: any) => call[0].records)
            .map((record: any) => record.entry as Record<string, unknown>);
          expect(entries).toEqual([{ a: "1", b: "x" }]);
          const update = repo.update.mock.calls[0]![0];
          expect(update.data.columnTypes).toEqual([
            { name: "a", type: "string" },
            { name: "b", type: "string" },
          ]);
        });
      });
    });

    describe("when the confirmed column count does not match the file headers", () => {
      // Defensive: the confirm UI locks add/remove so counts can't drift, but a
      // mismatch must never misalign — fall back to deriving all-`string`.
      it("ignores the confirmed columns and derives all-string from the headers", async () => {
        const { storage, writeChunks } = makeStorage({
          streamStaged: vi
            .fn()
            .mockResolvedValue(Readable.from(['{"a":"1","b":"x"}\n'])),
        });
        const repo = makeRepo({
          id: "d1",
          status: "processing",
          // Only one column for a two-column file → mismatch.
          columnTypes: [{ name: "a", type: "number" }],
        });

        const handler = createDatasetNormalizeHandler({
          repository: repo as any,
          getStorage: async () => storage as any,
        });
        await handler(basePayload);

        const entries = writeChunks.mock.calls
          .flatMap((call: any) => call[0].records)
          .map((record: any) => record.entry as Record<string, unknown>);
        // Values untouched (no number conversion) and original keys kept.
        expect(entries).toEqual([{ a: "1", b: "x" }]);
        const update = repo.update.mock.calls[0]![0];
        expect(update.data.columnTypes).toEqual([
          { name: "a", type: "string" },
          { name: "b", type: "string" },
        ]);
      });
    });
  });

  describe("when the uploaded file has no rows", () => {
    it("fails the dataset with an empty-file statusError instead of flipping to ready", async () => {
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from(["\n  \n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(handler(basePayload)).rejects.toThrow(/empty/i);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
      expect(update.data.statusError).toMatch(/empty/i);
    });
  });

  describe("when a JSONL line exceeds the max line size", () => {
    it("fails the dataset rather than buffering an unbounded line", async () => {
      const giant = `{"a":"${"x".repeat(9 * 1024 * 1024)}"}\n`;
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([giant])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(handler(basePayload)).rejects.toThrow(/max size|malformed/i);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
    });
  });

  // @regression — a re-drive that writes fewer chunks than a crashed prior run
  // leaves orphan chunk objects; the handler must delete them from the new
  // chunk count upward so the chunk set matches the PG counters (I-IDEM).
  describe("when a prior run left more chunks than this run writes", () => {
    /** @scenario "Retrying preparation does not duplicate rows" */
    it("deletes orphan chunks from the final count and stops at the first gap", async () => {
      const { storage, deleteChunksFrom } = makeStorage({
        // This run writes exactly 2 chunks (tiny per-chunk cap splits the rows).
        writeChunks: vi.fn(async ({ records, fromIndex = 0 }: any) =>
          toJsonlChunks(records, { maxBytes: 10 }).map((c) => ({
            ...c,
            index: c.index + fromIndex,
          })),
        ),
        streamStaged: vi
          .fn()
          .mockResolvedValue(
            Readable.from(['{"v":"aaaaaaaa"}\n{"v":"bbbbbbbb"}\n']),
          ),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      // deleteChunksFrom is called with fromIndex === this run's chunk count, so
      // any orphan at that index or beyond is reaped (the impl stops at the
      // first missing index).
      expect(deleteChunksFrom).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "d1",
        fromIndex: update.data.chunkCount,
      });
    });
  });
});
