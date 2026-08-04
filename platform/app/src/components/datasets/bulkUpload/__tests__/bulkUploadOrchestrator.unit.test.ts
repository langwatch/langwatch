import { describe, expect, it, vi } from "vitest";
import { DatasetNameConflictError } from "../../services/directUpload";
import {
  runWithConcurrency,
  type UploadSingleFileDeps,
  uploadSingleFile,
} from "../bulkUploadOrchestrator";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("runWithConcurrency", () => {
  describe("given more items than the cap", () => {
    it("never runs more than the cap at once and completes every item", async () => {
      let active = 0;
      let maxActive = 0;
      const done: number[] = [];
      await runWithConcurrency([0, 1, 2, 3, 4], 2, async (n) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        await Promise.resolve();
        done.push(n);
        active -= 1;
      });
      expect(maxActive).toBe(2);
      expect([...done].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    });

    /** @scenario A large batch starts a few files and queues the rest */
    it("starts a queued item as soon as a slot frees", async () => {
      const gates = [deferred(), deferred(), deferred()];
      const started: number[] = [];
      const all = runWithConcurrency([0, 1, 2], 1, async (n) => {
        started.push(n);
        await gates[n]!.promise;
      });

      // cap 1 → only the first item runs; the rest are queued.
      await Promise.resolve();
      expect(started).toEqual([0]);

      // Finishing item 0 frees the lane → item 1 starts.
      gates[0]!.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(started).toEqual([0, 1]);

      gates[1]!.resolve();
      gates[2]!.resolve();
      await all;
      expect(started).toEqual([0, 1, 2]);
    });
  });
});

const file = (name = "data.csv") => new File(["a,b\n1,2\n"], name);

const makeDeps = (
  overrides: Partial<UploadSingleFileDeps> = {},
): UploadSingleFileDeps => ({
  requestDirectUpload: vi.fn().mockResolvedValue({
    datasetId: "dataset_1",
    slug: "data",
    uploadUrl: "https://s3.example/put",
  }),
  putFileToPresignedUrl: vi.fn().mockResolvedValue(undefined),
  finalizeDirectUpload: vi.fn().mockResolvedValue({
    datasetId: "dataset_1",
    status: "processing",
  }),
  abortPendingUpload: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("uploadSingleFile", () => {
  const bump = (current: string) => `${current} (1)`;

  describe("given the happy path", () => {
    /** @scenario Large files do not freeze the app while uploading */
    it("creates, uploads, and finalizes, streaming the raw File (never read into memory)", async () => {
      const deps = makeDeps();
      const theFile = file();
      const result = await uploadSingleFile(
        { projectId: "p1", name: "data", file: theFile, nextName: bump },
        deps,
      );
      expect(result).toEqual({ datasetId: "dataset_1", finalName: "data" });
      // The raw File is handed to the PUT as-is — never read into an ArrayBuffer
      // first — so a multi-GB file streams without freezing the tab.
      expect(deps.putFileToPresignedUrl).toHaveBeenCalledTimes(1);
      const putCall = (deps.putFileToPresignedUrl as ReturnType<typeof vi.fn>)
        .mock.calls[0]!;
      expect(putCall[0]).toBe("https://s3.example/put");
      expect(putCall[1]).toBe(theFile);
      expect(deps.finalizeDirectUpload).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
      });
      expect(deps.abortPendingUpload).not.toHaveBeenCalled();
    });
  });

  describe("when the name conflicts (the batch-name race)", () => {
    it("bumps the name and retries the create without reaping anything", async () => {
      const requestDirectUpload = vi
        .fn()
        .mockRejectedValueOnce(new DatasetNameConflictError())
        .mockResolvedValueOnce({
          datasetId: "dataset_2",
          slug: "data-1",
          uploadUrl: "https://s3.example/put",
        });
      const deps = makeDeps({ requestDirectUpload });

      const result = await uploadSingleFile(
        { projectId: "p1", name: "data", file: file(), nextName: bump },
        deps,
      );

      expect(result.finalName).toBe("data (1)");
      expect(requestDirectUpload).toHaveBeenCalledTimes(2);
      expect(requestDirectUpload.mock.calls[1]![0]).toMatchObject({
        name: "data (1)",
      });
      // A conflict means no row was created, so nothing to reap.
      expect(deps.abortPendingUpload).not.toHaveBeenCalled();
    });
  });

  describe("when the upload fails after the row was created", () => {
    it("reaps the pending row and rethrows", async () => {
      const putFileToPresignedUrl = vi
        .fn()
        .mockRejectedValue(new Error("CORS"));
      const deps = makeDeps({ putFileToPresignedUrl });

      await expect(
        uploadSingleFile(
          { projectId: "p1", name: "data", file: file(), nextName: bump },
          deps,
        ),
      ).rejects.toThrow("CORS");

      expect(deps.abortPendingUpload).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
      });
      expect(deps.finalizeDirectUpload).not.toHaveBeenCalled();
    });
  });

  describe("when the upload is cancelled mid-flight", () => {
    it("reaps the pending row and rethrows the abort", async () => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      const putFileToPresignedUrl = vi.fn().mockRejectedValue(abortError);
      const deps = makeDeps({ putFileToPresignedUrl });

      await expect(
        uploadSingleFile(
          { projectId: "p1", name: "data", file: file(), nextName: bump },
          deps,
        ),
      ).rejects.toThrow("aborted");
      expect(deps.abortPendingUpload).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
      });
    });
  });
});
