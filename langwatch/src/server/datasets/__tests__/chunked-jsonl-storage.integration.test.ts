import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// Environment simulation (not a mock of the I/O): force the local-filesystem
// backend so the read/write/append/missing-chunk logic runs against a real fs.
// Per TESTING_PHILOSOPHY: use real implementations, mock only at boundaries.
vi.mock("~/env.mjs", () => ({ env: { DATASET_STORAGE_LOCAL: true } }));

import {
  writeDatasetChunks,
  readDatasetChunks,
  chunkKey,
} from "../chunked-jsonl-storage";

let storageDir: string;

beforeEach(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds-chunks-"));
  process.env.LOCAL_STORAGE_PATH = storageDir;
});

afterEach(async () => {
  delete process.env.LOCAL_STORAGE_PATH;
  await fs.rm(storageDir, { recursive: true, force: true });
});

describe("writeDatasetChunks() + readDatasetChunks()", () => {
  describe("given a dataset written to storage", () => {
    it("reads the same rows back in order", async () => {
      const records = [{ a: 1 }, { a: 2 }, { a: 3 }];
      const chunks = await writeDatasetChunks({
        projectId: "p1",
        datasetId: "d1",
        records,
      });

      const rows = await readDatasetChunks({
        projectId: "p1",
        datasetId: "d1",
        chunkCount: chunks.length,
      });

      expect(rows).toEqual(records);
    });
  });

  describe("when appending rows to an existing dataset", () => {
    it("preserves the original rows and appends the new ones in order", async () => {
      const first = await writeDatasetChunks({
        projectId: "p1",
        datasetId: "d2",
        records: [{ a: 1 }, { a: 2 }],
      });
      const second = await writeDatasetChunks({
        projectId: "p1",
        datasetId: "d2",
        records: [{ a: 3 }],
        fromIndex: first.length,
      });

      const rows = await readDatasetChunks({
        projectId: "p1",
        datasetId: "d2",
        chunkCount: first.length + second.length,
      });

      expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    });
  });
});

describe("readDatasetChunks()", () => {
  // @regression — a chunk that PG's chunkCount claims must exist is corruption,
  // not emptiness; returning "" would silently truncate the dataset (CodeRabbit).
  describe("when a chunk object is missing", () => {
    it("throws instead of returning a truncated dataset", async () => {
      const chunks = await writeDatasetChunks({
        projectId: "p1",
        datasetId: "d3",
        records: [{ a: 1 }],
      });
      await fs.rm(path.join(storageDir, chunkKey("p1", "d3", 0)));

      await expect(
        readDatasetChunks({
          projectId: "p1",
          datasetId: "d3",
          chunkCount: chunks.length,
        }),
      ).rejects.toThrow(/Missing dataset chunk/);
    });
  });
});

describe("writeDatasetChunks()", () => {
  describe("when an id contains a path-traversal sequence", () => {
    it("rejects it instead of writing outside the dataset prefix", async () => {
      await expect(
        writeDatasetChunks({
          projectId: "p1",
          datasetId: "../evil",
          records: [{ a: 1 }],
        }),
      ).rejects.toThrow(/traversal/);
    });
  });
});
