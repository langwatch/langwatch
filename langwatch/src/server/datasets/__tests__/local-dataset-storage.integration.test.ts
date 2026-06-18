import { Readable } from "node:stream";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDatasetHeadS3Jsonl } from "../../api/routers/datasetRecord.utils";
import { chunkKey } from "../dataset-chunking";
import {
  appendS3JsonlRecords,
  deleteS3JsonlRecords,
  editS3JsonlRecord,
} from "../dataset-mutations";
import { createDatasetNormalizeHandler } from "../dataset-normalize.job";
// Real-FS integration: exercise LocalDatasetStorage against a real temp dir.
// No env mock — the factory selects this impl; here we instantiate it directly
// and point its root at a tmp dir via LOCAL_STORAGE_PATH. Per
// TESTING_PHILOSOPHY: use real implementations, mock only at boundaries (the
// boundary here — the filesystem — is real, scoped to a temp dir).
//
// `.integration.test.ts` runs in CI under testcontainers; locally without
// Docker the integration runner won't start — that's expected.
import { LocalDatasetStorage } from "../local-dataset-storage";

const storage = new LocalDatasetStorage();
let storageDir: string;

beforeEach(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds-chunks-"));
  process.env.LOCAL_STORAGE_PATH = storageDir;
});

afterEach(async () => {
  delete process.env.LOCAL_STORAGE_PATH;
  await fs.rm(storageDir, { recursive: true, force: true });
});

describe("LocalDatasetStorage", () => {
  describe("writeChunks() + readChunks()", () => {
    describe("given a dataset written to storage", () => {
      it("reads the same rows back in order", async () => {
        const records = [{ a: 1 }, { a: 2 }, { a: 3 }];
        const chunks = await storage.writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records,
        });

        const rows = await storage.readChunks({
          projectId: "p1",
          datasetId: "d1",
          chunkCount: chunks.length,
        });

        expect(rows).toEqual(records);
      });
    });

    describe("when appending rows to an existing dataset", () => {
      it("preserves the original rows and appends the new ones in order", async () => {
        const first = await storage.writeChunks({
          projectId: "p1",
          datasetId: "d2",
          records: [{ a: 1 }, { a: 2 }],
        });
        const second = await storage.writeChunks({
          projectId: "p1",
          datasetId: "d2",
          records: [{ a: 3 }],
          fromIndex: first.length,
        });

        const rows = await storage.readChunks({
          projectId: "p1",
          datasetId: "d2",
          chunkCount: first.length + second.length,
        });

        expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
      });
    });
  });

  describe("readChunks()", () => {
    // @regression — a chunk that PG's chunkCount claims must exist is corruption,
    // not emptiness; returning "" would silently truncate the dataset (CodeRabbit).
    describe("when a chunk object is missing", () => {
      it("throws instead of returning a truncated dataset", async () => {
        const chunks = await storage.writeChunks({
          projectId: "p1",
          datasetId: "d3",
          records: [{ a: 1 }],
        });
        await fs.rm(path.join(storageDir, chunkKey("p1", "d3", 0)));

        await expect(
          storage.readChunks({
            projectId: "p1",
            datasetId: "d3",
            chunkCount: chunks.length,
          }),
        ).rejects.toThrow(/Missing dataset chunk/);
      });
    });
  });

  describe("writeChunks()", () => {
    describe("when an id contains a path-traversal sequence", () => {
      it("rejects it instead of writing outside the dataset prefix", async () => {
        await expect(
          storage.writeChunks({
            projectId: "p1",
            datasetId: "../evil",
            records: [{ a: 1 }],
          }),
        ).rejects.toThrow(/traversal/);
      });
    });
  });

  describe("createPresignedUpload()", () => {
    describe("when there is no browser-reachable storage", () => {
      it("signals the caller to fall back to the backend upload path", async () => {
        await expect(
          storage.createPresignedUpload({ projectId: "p1" }),
        ).rejects.toThrow(/Direct upload is unavailable/);
      });
    });
  });

  describe("streamStaged()", () => {
    describe("given a staged upload written to storage", () => {
      it("streams its bytes back", async () => {
        const key = "staging/p1/u1";
        const filePath = path.join(storageDir, key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, '{"a":1}\n{"a":2}\n', "utf-8");

        const stream = await storage.streamStaged({ projectId: "p1", key });
        const chunks: string[] = [];
        for await (const chunk of stream) chunks.push(String(chunk));

        expect(chunks.join("")).toBe('{"a":1}\n{"a":2}\n');
      });
    });

    describe("when the staged upload is missing", () => {
      it("throws StagedUploadNotFoundError", async () => {
        await expect(
          storage.streamStaged({ projectId: "p1", key: "staging/p1/missing" }),
        ).rejects.toThrow(/Uploaded object not found/);
      });
    });
  });

  // Read-back round-trip (m6): run the real normalize handler against the real
  // filesystem, then read the chunks back — so the bound scenarios are backed
  // by actual stored bytes, not just a write-side `repository.update` assertion.
  describe("normalize → read round-trip", () => {
    /** Stage a raw upload on disk under the project's staging prefix. */
    const stage = async (
      projectId: string,
      uploadId: string,
      content: string,
    ): Promise<string> => {
      const key = `staging/${projectId}/${uploadId}`;
      const filePath = path.join(storageDir, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return key;
    };

    /**
     * Run the real handler with the real LocalDatasetStorage and a stub repo
     * that captures the `ready` update; returns the rows read back from disk.
     */
    const normalizeAndReadBack = async (params: {
      projectId: string;
      datasetId: string;
      uploadId: string;
      filename: string;
      content: string;
    }) => {
      const stagingKey = await stage(
        params.projectId,
        params.uploadId,
        params.content,
      );
      const update = vi.fn().mockResolvedValue({});
      const repository = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: params.datasetId, status: "processing" }),
        update,
      };
      const handler = createDatasetNormalizeHandler({
        repository: repository as never,
        getStorage: async () => storage,
      });
      await handler({
        id: params.datasetId,
        tenantId: params.projectId,
        projectId: params.projectId,
        datasetId: params.datasetId,
        stagingKey,
        filename: params.filename,
      });
      const ready = update.mock.calls[0]![0].data;
      const rows = await storage.readChunks({
        projectId: params.projectId,
        datasetId: params.datasetId,
        chunkCount: ready.chunkCount,
      });
      return { ready, rows };
    };

    describe("given a JSONL upload", () => {
      /** @scenario "Both CSV and JSONL files are accepted" */
      it("normalizes to disk and reads the same rows back", async () => {
        const { ready, rows } = await normalizeAndReadBack({
          projectId: "p1",
          datasetId: "rt-jsonl",
          uploadId: "u-jsonl",
          filename: "data.jsonl",
          content: '{"a":"1","b":"x"}\n{"a":"2","b":"y"}\n',
        });

        expect(ready.status).toBe("ready");
        // Each chunk line is wrapped as { id, entry } so a later edit/delete
        // can target the row by id; the entry holds the original row.
        expect(rows.map((r) => (r as { entry: unknown }).entry)).toEqual([
          { a: "1", b: "x" },
          { a: "2", b: "y" },
        ]);
      });
    });

    describe("given a CSV upload", () => {
      /** @scenario "Both CSV and JSONL files are accepted" */
      it("normalizes to disk and reads the same rows back", async () => {
        const { ready, rows } = await normalizeAndReadBack({
          projectId: "p1",
          datasetId: "rt-csv",
          uploadId: "u-csv",
          filename: "data.csv",
          content: "a,b\n1,x\n2,y\n",
        });

        expect(ready.status).toBe("ready");
        expect(rows.map((r) => (r as { entry: unknown }).entry)).toEqual([
          { a: "1", b: "x" },
          { a: "2", b: "y" },
        ]);
      });
    });

    describe("given a ready dataset read back from disk", () => {
      /** @scenario "A ready dataset reports its true row count and size" */
      it("reports the true rowCount and a positive sizeBytes matching the stored bytes", async () => {
        const content =
          Array.from({ length: 50 }, (_, i) => `{"a":"${i}"}`).join("\n") +
          "\n";
        const { ready, rows } = await normalizeAndReadBack({
          projectId: "p1",
          datasetId: "rt-count",
          uploadId: "u-count",
          filename: "data.jsonl",
          content,
        });

        expect(ready.status).toBe("ready");
        expect(ready.rowCount).toBe(50);
        expect(ready.sizeBytes).toBeGreaterThan(0n);
        expect(rows).toHaveLength(50);
      });
    });

    // ADR-032 Decision 6 / I-READY: a read against a still-preparing s3_jsonl
    // dataset must refuse — never serve partial/half-prepared rows — across the
    // read consumers. The status gate fires before any storage read, so a
    // `processing`/`failed` dataset is treated as not ready. This drives the
    // read path (`readDatasetHeadS3Jsonl`, shared by the head/UI read) with a
    // real dataset row shape.
    describe("given a dataset that is still processing", () => {
      /** @scenario "A dataset still being prepared is not used as data" */
      it("refuses the read as not-ready instead of serving partial rows", async () => {
        await expect(
          readDatasetHeadS3Jsonl({
            dataset: {
              id: "rt-processing",
              projectId: "p1",
              contentLayout: "s3_jsonl",
              status: "processing",
              statusError: null,
              chunkCount: 0,
              rowCount: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as never,
            projectId: "p1",
          }),
        ).rejects.toMatchObject({
          name: "DatasetNotReadyError",
          status: "processing",
        });
      });
    });
  });

  // Write-mutations round-trip (rung 6b): drive the real append/edit/delete
  // mutations against the real LocalDatasetStorage, with a prisma stub that
  // serves the live dataset row through the advisory-lock transaction seam. The
  // chunk files on disk and the recomputed PG counters are both asserted, so the
  // bound scenarios are backed by actual stored bytes — not just a write-side
  // `update` spy.
  describe("append / edit / delete round-trip", () => {
    /**
     * A prisma stub whose `$transaction(fn)` runs `fn(tx)` against a mutable
     * in-memory `Dataset` row. `tx.dataset.findFirstOrThrow` returns the live
     * row; `tx.dataset.update` applies the data patch to it (so a later
     * mutation sees the advanced counters). `tx.$queryRaw` stands in for the
     * advisory lock.
     */
    const makePrismaOver = (row: Record<string, unknown>) => {
      const prisma = {
        $transaction: async (fn: (tx: unknown) => unknown) =>
          fn({
            $queryRaw: async () => [],
            dataset: {
              findFirstOrThrow: async () => ({ ...row }),
              update: async ({ data }: { data: Record<string, unknown> }) => {
                Object.assign(row, data);
                return { ...row };
              },
            },
          }),
      };
      return prisma;
    };

    /** Seed a ready s3_jsonl dataset on disk via the append path, returning the
     * mutable row + the storage to keep mutating. */
    const seed = async (
      projectId: string,
      datasetId: string,
      entries: unknown[],
    ) => {
      const row: Record<string, unknown> = {
        id: datasetId,
        projectId,
        contentLayout: "s3_jsonl",
        status: "ready",
        statusError: null,
        rowCount: 0,
        sizeBytes: 0n,
        chunkCount: 0,
        chunkOffsets: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const prisma = makePrismaOver(row);
      await appendS3JsonlRecords({
        prisma: prisma as never,
        dataset: row as never,
        projectId,
        entries,
        storage,
      });
      return { row, prisma };
    };

    /** Read every chunk's lines back from disk in order. */
    const readAll = async (
      projectId: string,
      datasetId: string,
      chunkCount: number,
    ) =>
      (await storage.readChunks({
        projectId,
        datasetId,
        chunkCount,
      })) as Array<{ id: string; entry: unknown }>;

    /** @scenario "Appending rows adds new data and preserves existing rows" */
    it("appends new rows, preserves the originals, and updates the counts", async () => {
      const projectId = "p1";
      const datasetId = "mut-append";
      const { row, prisma } = await seed(projectId, datasetId, [
        { a: 1 },
        { a: 2 },
        { a: 3 },
        { a: 4 },
        { a: 5 },
        { a: 6 },
        { a: 7 },
        { a: 8 },
        { a: 9 },
        { a: 10 },
      ]);
      expect(row.rowCount).toBe(10);

      await appendS3JsonlRecords({
        prisma: prisma as never,
        dataset: row as never,
        projectId,
        entries: [{ a: 11 }, { a: 12 }, { a: 13 }, { a: 14 }, { a: 15 }],
        storage,
      });

      // PG-authoritative count reflects the append.
      expect(row.rowCount).toBe(15);
      const rows = await readAll(
        projectId,
        datasetId,
        row.chunkCount as number,
      );
      // Original 10 unchanged, 5 appended in order.
      expect(rows.map((r) => r.entry)).toEqual(
        Array.from({ length: 15 }, (_, i) => ({ a: i + 1 })),
      );
    });

    /** @scenario "Editing or deleting a row updates only that row" */
    it("edits one row and deletes another, leaving the rest unaffected", async () => {
      const projectId = "p1";
      const datasetId = "mut-edit-delete";
      const { row, prisma } = await seed(projectId, datasetId, [
        { a: 1 },
        { a: 2 },
        { a: 3 },
      ]);
      const seeded = await readAll(
        projectId,
        datasetId,
        row.chunkCount as number,
      );
      const [r1, r2, r3] = seeded;

      // Edit r2.
      await editS3JsonlRecord({
        prisma: prisma as never,
        dataset: row as never,
        projectId,
        recordId: r2!.id,
        entry: { a: 99 },
        storage,
      });
      // Delete r1.
      await deleteS3JsonlRecords({
        prisma: prisma as never,
        dataset: row as never,
        projectId,
        recordIds: [r1!.id],
        storage,
      });

      expect(row.rowCount).toBe(2);
      const rows = await readAll(
        projectId,
        datasetId,
        row.chunkCount as number,
      );
      // r1 gone; r2 carries the edited entry; r3 unaffected.
      expect(rows.map((r) => r.id)).toEqual([r2!.id, r3!.id]);
      expect(rows.map((r) => r.entry)).toEqual([{ a: 99 }, { a: 3 }]);
    });

    // m2: every row in a chunk deleted → the chunk is LEFT in place as an empty
    // chunk (no compaction). A subsequent readChunks round-trip must skip the
    // empty chunk and return exactly the remaining rows in order, with
    // chunkCount unchanged and the emptied chunk's offset collapsed to
    // startRow===endRow.
    /** @scenario "Editing or deleting a row updates only that row" */
    it("deletes every row in a chunk, leaving an empty chunk in place, and reads the remaining rows back", async () => {
      const projectId = "p1";
      const datasetId = "mut-empty-chunk";
      // Two separate appends → two chunks (append always writes from chunkCount).
      const { row, prisma } = await seed(projectId, datasetId, [
        { a: 1 },
        { a: 2 },
      ]);
      await appendS3JsonlRecords({
        prisma: prisma as never,
        dataset: row as never,
        projectId,
        entries: [{ a: 3 }, { a: 4 }],
        storage,
      });
      expect(row.chunkCount).toBe(2);
      expect(row.rowCount).toBe(4);

      const seeded = await readAll(
        projectId,
        datasetId,
        row.chunkCount as number,
      );
      // First chunk holds the first two rows; delete BOTH → chunk 0 emptied.
      const [r1, r2] = seeded;
      await deleteS3JsonlRecords({
        prisma: prisma as never,
        dataset: row as never,
        projectId,
        recordIds: [r1!.id, r2!.id],
        storage,
      });

      // chunkCount unchanged (empty chunk kept); rowCount drops to 2.
      expect(row.chunkCount).toBe(2);
      expect(row.rowCount).toBe(2);
      const offsets = row.chunkOffsets as Array<{
        index: number;
        startRow: number;
        endRow: number;
      }>;
      // Emptied chunk 0 collapsed to startRow===endRow; chunk 1 shifted to [0,2).
      expect(offsets[0]).toMatchObject({ index: 0, startRow: 0, endRow: 0 });
      expect(offsets[1]).toMatchObject({ index: 1, startRow: 0, endRow: 2 });

      // Round-trip: readChunks tolerates the empty chunk (parses to []) and
      // returns exactly the remaining rows in order.
      const rows = await readAll(
        projectId,
        datasetId,
        row.chunkCount as number,
      );
      expect(rows.map((r) => r.entry)).toEqual([{ a: 3 }, { a: 4 }]);
    });
  });
});
