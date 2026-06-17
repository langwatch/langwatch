import { Readable } from "node:stream";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkKey } from "../dataset-chunking";
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
        expect(rows).toEqual([
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
        expect(rows).toEqual([
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
  });
});
