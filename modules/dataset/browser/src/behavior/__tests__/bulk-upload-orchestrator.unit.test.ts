import type { StoredObjectReference } from "@langwatch/stored-object-contract";
import { describe, expect, it, vi } from "vitest";

import {
  DatasetNameConflictError,
  runWithConcurrency,
  type UploadSingleFileDeps,
  uploadSingleFile,
} from "../bulk-upload-orchestrator.ts";

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
      expect([...done].toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
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

const reference: StoredObjectReference = {
  projectId: "p1",
  id: "so_1",
  sha256: "a".repeat(64),
  byteLength: 8,
  filename: "data.csv",
  mediaType: "text/csv",
  audience: "datasets:view",
};

const nameTaken = () =>
  Object.assign(new Error("dataset_name_taken"), {
    data: { error: { code: "dataset_name_taken", httpStatus: 409, meta: {} } },
  });

const makeDeps = (overrides: Partial<UploadSingleFileDeps> = {}) => ({
  uploadStoredObject: vi
    .fn<UploadSingleFileDeps["uploadStoredObject"]>()
    .mockResolvedValue(reference),
  createFromStoredObject: vi
    .fn<UploadSingleFileDeps["createFromStoredObject"]>()
    .mockResolvedValue({ datasetId: "dataset_1", slug: "data", status: "processing" }),
  ...overrides,
});

describe("uploadSingleFile", () => {
  const bump = (current: string) => `${current} (1)`;

  describe("given the happy path", () => {
    /** @scenario Large files do not freeze the app while uploading */
    it("uploads the raw File once, then creates the dataset from it", async () => {
      const deps = makeDeps();
      const theFile = file();
      const result = await uploadSingleFile(
        { projectId: "p1", name: "data", file: theFile, nextName: bump },
        deps,
      );
      expect(result).toEqual({ datasetId: "dataset_1", finalName: "data" });
      // The raw File goes to the upload as-is, never read into memory first.
      expect(deps.uploadStoredObject).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "p1", purpose: "dataset_import", file: theFile }),
      );
      expect(deps.createFromStoredObject).toHaveBeenCalledWith({
        projectId: "p1",
        name: "data",
        storedObjectId: "so_1",
        columnTypes: undefined,
      });
    });
  });

  describe("when the name is taken (the batch-name race)", () => {
    it("bumps the name and creates again from the same upload", async () => {
      const createFromStoredObject = vi
        .fn<UploadSingleFileDeps["createFromStoredObject"]>()
        .mockRejectedValueOnce(nameTaken())
        .mockResolvedValueOnce({ datasetId: "dataset_2", slug: "data-1", status: "processing" });
      const deps = makeDeps({ createFromStoredObject });

      const result = await uploadSingleFile(
        { projectId: "p1", name: "data", file: file(), nextName: bump },
        deps,
      );

      expect(result).toEqual({ datasetId: "dataset_2", finalName: "data (1)" });
      expect(createFromStoredObject.mock.calls[1]![0]).toMatchObject({ name: "data (1)" });
      expect(deps.uploadStoredObject).toHaveBeenCalledTimes(1);
    });
  });

  describe("when every candidate name is taken", () => {
    it("gives up with DatasetNameConflictError", async () => {
      const createFromStoredObject = vi
        .fn<UploadSingleFileDeps["createFromStoredObject"]>()
        .mockRejectedValue(nameTaken());
      const deps = makeDeps({ createFromStoredObject });

      await expect(
        uploadSingleFile({ projectId: "p1", name: "data", file: file(), nextName: bump }, deps),
      ).rejects.toBeInstanceOf(DatasetNameConflictError);
    });
  });

  describe("when the upload fails", () => {
    it("rethrows and creates no dataset", async () => {
      const uploadStoredObject = vi
        .fn<UploadSingleFileDeps["uploadStoredObject"]>()
        .mockRejectedValue(new Error("CORS"));
      const deps = makeDeps({ uploadStoredObject });

      await expect(
        uploadSingleFile({ projectId: "p1", name: "data", file: file(), nextName: bump }, deps),
      ).rejects.toThrow("CORS");
      expect(deps.createFromStoredObject).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset refuses the source file", () => {
    it("rethrows the refusal without retrying under another name", async () => {
      const refused = Object.assign(new Error("dataset_import_source_refused"), {
        data: { error: { code: "dataset_import_source_refused", httpStatus: 422, meta: {} } },
      });
      const createFromStoredObject = vi
        .fn<UploadSingleFileDeps["createFromStoredObject"]>()
        .mockRejectedValue(refused);
      const deps = makeDeps({ createFromStoredObject });

      await expect(
        uploadSingleFile({ projectId: "p1", name: "data", file: file(), nextName: bump }, deps),
      ).rejects.toBe(refused);
      expect(createFromStoredObject).toHaveBeenCalledTimes(1);
    });
  });
});
