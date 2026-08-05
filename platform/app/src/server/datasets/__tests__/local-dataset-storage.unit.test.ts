import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the fs boundary so we can drive the write path into specific errno
// failures (EACCES vs ENOSPC) without touching a real filesystem. The chunk
// (de)serialization + key math under test stay real. The source imports
// `fs from "fs/promises"`, so we mock that exact specifier's default export.
const mkdir = vi.fn();
const writeFile = vi.fn();
vi.mock("fs/promises", () => ({
  default: {
    mkdir: (...args: unknown[]) => mkdir(...args),
    writeFile: (...args: unknown[]) => writeFile(...args),
  },
}));

import { LocalDatasetStorage } from "../local-dataset-storage";

/** Build an Error carrying a Node errno `code`, mirroring what fs rejects with. */
const errnoError = (code: string): Error => {
  const error = new Error(`${code}: simulated`);
  (error as Error & { code: string }).code = code;
  return error;
};

const ROOT = "/var/lib/langwatch/objects";

const writeOneRecord = () =>
  new LocalDatasetStorage(ROOT).writeChunks({
    projectId: "p1",
    datasetId: "d1",
    records: [{ id: "r1", entry: { a: 1 } }],
    fromIndex: 0,
  });

beforeEach(() => {
  mkdir.mockReset();
  writeFile.mockReset();
  writeFile.mockResolvedValue(undefined);
});

describe("LocalDatasetStorage", () => {
  describe("writeChunks()", () => {
    describe("when the storage path is not writable", () => {
      it("throws an actionable error naming the root and the S3 / LANGWATCH_LOCAL_STORAGE_PATH fix", async () => {
        mkdir.mockRejectedValue(errnoError("EACCES"));

        const promise = writeOneRecord();

        await expect(promise).rejects.toThrow(ROOT);
        await expect(promise).rejects.toThrow("is not writable");
        await expect(promise).rejects.toThrow("S3_BUCKET_NAME");
        await expect(promise).rejects.toThrow("LANGWATCH_LOCAL_STORAGE_PATH");
      });
    });

    describe("when the write fails for an unrelated reason", () => {
      it("re-throws the original error as-is without wrapping it", async () => {
        const original = errnoError("ENOSPC");
        mkdir.mockRejectedValue(original);

        await expect(writeOneRecord()).rejects.toBe(original);
      });
    });
  });

  describe("createPresignedUpload()", () => {
    // Local FS has no browser-reachable bucket, so instead of throwing (the old
    // behavior that forced the in-browser-parse fallback + 25 MB cap) it mints a
    // SAME-ORIGIN upload URL the browser streams to (ADR-032 v14). Pure — no FS.
    describe("on a local-FS backend", () => {
      it("returns a same-origin staging URL and the tenant-scoped staging key", async () => {
        const presign = await new LocalDatasetStorage(
          ROOT,
        ).createPresignedUpload({ projectId: "p1" });

        // Relative URL → the modal's PUT helper reads "/" as same-origin and
        // sends the session cookie (vs an absolute S3 URL → no credentials).
        expect(presign.url).toBe(
          `/api/dataset/direct-upload/staging/${presign.uploadId}?projectId=p1`,
        );
        // The key matches what finalize/normalize expect: staging/{project}/{id}.
        expect(presign.key).toBe(`staging/p1/${presign.uploadId}`);
        expect(presign.uploadId).toBeTruthy();
      });
    });
  });
});
