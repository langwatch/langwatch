import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkKey } from "../dataset-chunking";
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
});
