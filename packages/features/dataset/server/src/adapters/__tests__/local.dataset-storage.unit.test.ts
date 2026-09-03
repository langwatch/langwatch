import { HandledError } from "@langwatch/handled-error";
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

import { LocalDatasetStorageAdapter } from "../local.dataset-storage.adapter";

/** Build an Error carrying a Node errno `code`, mirroring what fs rejects with. */
const errnoError = (code: string): Error => {
  const error = new Error(`${code}: simulated`);
  (error as Error & { code: string }).code = code;
  return error;
};

const ROOT = "/var/lib/langwatch/objects";

const writeOneRecord = () =>
  new LocalDatasetStorageAdapter(ROOT).writeChunks({
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

describe("LocalDatasetStorageAdapter", () => {
  describe("writeChunks()", () => {
    describe("when the storage path is not writable", () => {
      /** @scenario The refusal carries the storage_not_writable code */
      it("refuses with the storage_not_writable code, attributed to the platform", async () => {
        mkdir.mockRejectedValue(errnoError("EACCES"));

        const error = await writeOneRecord().catch((e: unknown) => e);

        expect(HandledError.isHandled(error)).toBe(true);
        expect((error as HandledError).code).toBe("storage_not_writable");
        expect((error as HandledError).fault).toBe("platform");
      });

      /** @scenario The message names no environment variable and no path */
      it("keeps the environment variables and the root out of the message", async () => {
        mkdir.mockRejectedValue(errnoError("EROFS"));

        const error = (await writeOneRecord().catch((e: unknown) => e)) as HandledError;

        expect(error.message).not.toContain("S3_BUCKET_NAME");
        expect(error.message).not.toContain("LANGWATCH_LOCAL_STORAGE_PATH");
        expect(error.message).not.toContain(ROOT);
        expect(error.message).not.toContain("/");
      });
    });

    describe("when the write fails for an unrelated reason", () => {
      /** @scenario A permission failure that is not a write refusal stays unknown */
      it("re-throws the original error as-is without wrapping it", async () => {
        const original = errnoError("ENOSPC");
        mkdir.mockRejectedValue(original);

        const error = await writeOneRecord().catch((e: unknown) => e);

        expect(error).toBe(original);
        expect(HandledError.isHandled(error)).toBe(false);
      });
    });
  });

  describe("createPresignedUpload()", () => {
    // Local FS has no browser-reachable bucket, so instead of throwing (the old
    // behavior that forced the in-browser-parse fallback + 25 MB cap) it mints a
    // SAME-ORIGIN upload URL the browser streams to (ADR-032 v14). Pure — no FS.
    describe("on a local-FS backend", () => {
      it("returns a same-origin staging URL and the tenant-scoped staging key", async () => {
        const presign = await new LocalDatasetStorageAdapter(ROOT).createPresignedUpload({
          projectId: "p1",
        });

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
