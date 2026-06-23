import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock only the boundaries: the storage service (S3/local), the normalize
// enqueue seam, and (via stubs) the repository. The service logic under test
// stays real.
vi.mock("../dataset-storage", () => ({ getDatasetStorage: vi.fn() }));
vi.mock("../dataset-normalize.queue", () => ({
  enqueueDatasetNormalize: vi.fn().mockResolvedValue(undefined),
}));

import { DatasetService } from "../dataset.service";
import { enqueueDatasetNormalize } from "../dataset-normalize.queue";
import { getDatasetStorage } from "../dataset-storage";
import {
  DatasetNotRetryableError,
  DirectUploadUnavailableError,
  StagedUploadNotFoundError,
} from "../errors";
import { UPLOAD_MAX_BYTES } from "../presigned-upload";

const makeService = (repo: Record<string, unknown>) =>
  new DatasetService({} as any, repo as any, {} as any, {} as any);

describe("DatasetService", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("createPendingUpload()", () => {
    describe("when the backend supports presigned upload", () => {
      it("mints a presigned upload and creates the dataset in uploading", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          createPresignedUpload: vi.fn().mockResolvedValue({
            uploadId: "u1",
            key: "staging/p1/u1",
            url: "https://example/put",
          }),
        } as any);
        const repo = {
          findBySlug: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "dataset_x", slug: "ds" }),
        };

        const result = await makeService(repo).createPendingUpload({
          projectId: "p1",
          name: "DS",
          filename: "data.jsonl",
        });

        // The raw staging key is NOT leaked in the response — the client only
        // needs datasetId + uploadUrl; finalize reads the key from the row (C1).
        expect(result).toMatchObject({
          datasetId: "dataset_x",
          uploadUrl: "https://example/put",
        });
        expect(result).not.toHaveProperty("stagingKey");
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "uploading",
            contentLayout: "s3_jsonl",
            projectId: "p1",
            stagingKey: "staging/p1/u1",
            uploadFilename: "data.jsonl",
          }),
        );
      });
    });

    describe("when the name already exists", () => {
      it("rejects before minting a presigned URL (C2)", async () => {
        const createPresignedUpload = vi.fn();
        vi.mocked(getDatasetStorage).mockResolvedValue({
          createPresignedUpload,
        } as any);
        const repo = {
          findBySlug: vi.fn().mockResolvedValue({ id: "existing" }),
          create: vi.fn(),
        };

        await expect(
          makeService(repo).createPendingUpload({
            projectId: "p1",
            name: "DS",
            filename: "data.jsonl",
          }),
        ).rejects.toThrow(/already exists/i);
        expect(createPresignedUpload).not.toHaveBeenCalled();
        expect(repo.create).not.toHaveBeenCalled();
      });
    });

    describe("when the backend cannot presign (self-hosted / no S3)", () => {
      it("propagates DirectUploadUnavailableError without creating a row", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          createPresignedUpload: vi
            .fn()
            .mockRejectedValue(new DirectUploadUnavailableError()),
        } as any);
        const repo = {
          findBySlug: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        };

        await expect(
          makeService(repo).createPendingUpload({
            projectId: "p1",
            name: "DS",
            filename: "data.jsonl",
          }),
        ).rejects.toThrow(/Direct upload is unavailable/);
        expect(repo.create).not.toHaveBeenCalled();
      });
    });

    describe("when abandoned pending uploads linger (poll-triggered reap)", () => {
      it("archives stale uploading rows and deletes their staging objects before minting", async () => {
        const deleteStaged = vi.fn().mockResolvedValue(undefined);
        vi.mocked(getDatasetStorage).mockResolvedValue({
          deleteStaged,
          createPresignedUpload: vi.fn().mockResolvedValue({
            uploadId: "u2",
            key: "staging/p1/u2",
            url: "https://example/put",
          }),
        } as any);
        const stale = {
          id: "dataset_stale",
          name: "Old Upload",
          projectId: "p1",
          status: "uploading",
          stagingKey: "staging/p1/old",
          archivedAt: null,
        };
        const repo = {
          findStalePendingUploads: vi.fn().mockResolvedValue([stale]),
          findBySlug: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "dataset_new", slug: "ds" }),
          update: vi.fn().mockResolvedValue({}),
        };

        await makeService(repo).createPendingUpload({
          projectId: "p1",
          name: "DS",
          filename: "data.jsonl",
        });

        // the abandoned row's staging object is deleted and the row archived...
        expect(deleteStaged).toHaveBeenCalledWith({
          projectId: "p1",
          key: "staging/p1/old",
        });
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "dataset_stale",
            projectId: "p1",
            data: expect.objectContaining({ archivedAt: expect.any(Date) }),
          }),
        );
        // ...and the new upload still proceeds
        expect(repo.create).toHaveBeenCalled();
      });

      it("never blocks the upload when the sweep itself fails", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          createPresignedUpload: vi.fn().mockResolvedValue({
            uploadId: "u3",
            key: "staging/p1/u3",
            url: "https://example/put",
          }),
        } as any);
        const repo = {
          findStalePendingUploads: vi
            .fn()
            .mockRejectedValue(new Error("db down")),
          findBySlug: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "dataset_new", slug: "ds" }),
        };

        const result = await makeService(repo).createPendingUpload({
          projectId: "p1",
          name: "DS",
          filename: "data.jsonl",
        });

        expect(result).toMatchObject({ datasetId: "dataset_new" });
        expect(repo.create).toHaveBeenCalled();
      });
    });
  });

  describe("abortPendingUpload()", () => {
    describe("when aborting a still-pending upload", () => {
      it("deletes the staged object and archives the uploading row", async () => {
        const deleteStaged = vi.fn().mockResolvedValue(undefined);
        vi.mocked(getDatasetStorage).mockResolvedValue({ deleteStaged } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "dataset_x",
            projectId: "p1",
            name: "DS",
            status: "uploading",
            stagingKey: "staging/p1/u1",
            archivedAt: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        };

        const result = await makeService(repo).abortPendingUpload({
          projectId: "p1",
          datasetId: "dataset_x",
        });

        expect(result).toEqual({ datasetId: "dataset_x", aborted: true });
        expect(deleteStaged).toHaveBeenCalledWith({
          projectId: "p1",
          key: "staging/p1/u1",
        });
        // Archived (soft-deleted), not hard-deleted.
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "dataset_x",
            projectId: "p1",
            data: expect.objectContaining({ archivedAt: expect.any(Date) }),
          }),
        );
      });
    });

    describe("when the dataset is no longer in uploading", () => {
      it("rejects with UploadNotPendingError (never reaps real content)", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          deleteStaged: vi.fn(),
        } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "dataset_x",
            name: "DS",
            status: "ready",
            archivedAt: null,
          }),
          update: vi.fn(),
        };

        await expect(
          makeService(repo).abortPendingUpload({
            projectId: "p1",
            datasetId: "dataset_x",
          }),
        ).rejects.toThrow(/not pending/i);
        expect(repo.update).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset does not exist", () => {
      it("rejects with DatasetNotFoundError", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        };

        await expect(
          makeService(repo).abortPendingUpload({
            projectId: "p1",
            datasetId: "missing",
          }),
        ).rejects.toThrow();
        expect(repo.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("finalizeUpload()", () => {
    describe("when the dataset's bound staging key drives the HEAD", () => {
      it("HEADs the row's stagingKey and flips the dataset to processing", async () => {
        const headStagedObjectSize = vi.fn().mockResolvedValue(1024);
        vi.mocked(getDatasetStorage).mockResolvedValue({
          headStagedObjectSize,
        } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "uploading",
            stagingKey: "staging/p1/bound-key",
            uploadFilename: "data.jsonl",
          }),
          update: vi.fn().mockResolvedValue({}),
        };

        const result = await makeService(repo).finalizeUpload({
          projectId: "p1",
          datasetId: "d1",
        });

        expect(headStagedObjectSize).toHaveBeenCalledWith({
          projectId: "p1",
          key: "staging/p1/bound-key",
        });
        expect(result.status).toBe("processing");
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: "processing" } }),
        );
        // Enqueues the normalize job with tenantId === projectId and the
        // filename bound to the row (drives format detection).
        expect(enqueueDatasetNormalize).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              datasetId: "d1",
              projectId: "p1",
              tenantId: "p1",
              stagingKey: "staging/p1/bound-key",
              filename: "data.jsonl",
            }),
          }),
        );
      });
    });

    describe("when the staged object exceeds the size cap", () => {
      it("deletes the staged object, marks the dataset failed, and throws", async () => {
        const deleteStaged = vi.fn().mockResolvedValue(undefined);
        vi.mocked(getDatasetStorage).mockResolvedValue({
          headStagedObjectSize: vi.fn().mockResolvedValue(UPLOAD_MAX_BYTES + 1),
          deleteStaged,
        } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "uploading",
            stagingKey: "staging/p1/k",
            uploadFilename: "data.jsonl",
          }),
          update: vi.fn().mockResolvedValue({}),
        };

        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toThrow(/maximum/i);
        expect(deleteStaged).toHaveBeenCalledWith({
          projectId: "p1",
          key: "staging/p1/k",
        });
        // @regression — over-cap finalize must null the stagingKey alongside the
        // failed flip. The staged object was just deleted; leaving the key set
        // makes retryNormalize re-drive a deleted object and fail with the
        // misleading "Uploaded object not found" instead of the over-cap cause.
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: "failed",
              stagingKey: null,
            }),
          }),
        );
      });

      describe("and the over-cap dataset is then retried", () => {
        it("is not retryable — the staged source was deleted (no re-drive of a missing object)", async () => {
          // The over-cap finalize nulled stagingKey, so retryNormalize has no
          // source to re-read and refuses rather than enqueuing a doomed job.
          const repo = {
            findOne: vi.fn().mockResolvedValue({
              id: "d1",
              status: "failed",
              statusError: "Uploaded file is too large",
              stagingKey: null,
            }),
            update: vi.fn().mockResolvedValue({}),
          };

          await expect(
            makeService(repo).retryNormalize({
              projectId: "p1",
              datasetId: "d1",
            }),
          ).rejects.toMatchObject({ name: "DatasetNotRetryableError" });
          expect(repo.update).not.toHaveBeenCalled();
        });
      });
    });

    describe("when the staged object is missing or incomplete", () => {
      it("flips the dataset to failed and surfaces StagedUploadNotFoundError", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          headStagedObjectSize: vi
            .fn()
            .mockRejectedValue(new StagedUploadNotFoundError()),
        } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "uploading",
            stagingKey: "staging/p1/k",
            uploadFilename: "data.jsonl",
          }),
          update: vi.fn().mockResolvedValue({}),
        };

        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: "failed",
              statusError: "Uploaded object not found",
            }),
          }),
        );
      });
    });

    describe("when the dataset is not in the uploading state", () => {
      it("throws UploadNotPendingError without HEADing storage", async () => {
        const headStagedObjectSize = vi.fn();
        vi.mocked(getDatasetStorage).mockResolvedValue({
          headStagedObjectSize,
        } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "processing",
            stagingKey: "staging/p1/k",
          }),
        };

        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toThrow(/not pending/i);
        expect(headStagedObjectSize).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset has no bound staging key", () => {
      it("throws UploadNotPendingError", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "uploading",
            stagingKey: null,
          }),
        };

        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toThrow(/no pending staged upload/i);
      });
    });

    describe("when the dataset has a staging key but no filename", () => {
      it("fails loudly instead of guessing a .jsonl format", async () => {
        // M1 co-sets filename with the staging key; a present key with no
        // filename is a corrupt row. The old `?? `${id}.jsonl`` fallback would
        // silently parse a CSV as JSONL — fail instead.
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "uploading",
            stagingKey: "staging/p1/k",
            uploadFilename: null,
          }),
        };

        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toThrow(/missing its filename/i);
        expect(enqueueDatasetNormalize).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset is archived", () => {
      it("throws DatasetNotFoundError", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "uploading",
            stagingKey: "staging/p1/k",
            archivedAt: new Date(),
          }),
        };

        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toThrow(/not found/i);
      });
    });

    describe("when the dataset does not exist", () => {
      it("throws DatasetNotFoundError", async () => {
        const repo = { findOne: vi.fn().mockResolvedValue(null) };
        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "missing",
          }),
        ).rejects.toThrow(/not found/i);
      });
    });
  });

  describe("retryNormalize()", () => {
    describe("when retrying a failed dataset (I-RECOVER)", () => {
      /** @scenario "An interrupted preparation loses nothing and can be retried" */
      it("flips the dataset back to processing and re-enqueues normalize", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "failed",
            stagingKey: "staging/p1/k",
            uploadFilename: "data.jsonl",
          }),
          update: vi.fn().mockResolvedValue({}),
        };

        const result = await makeService(repo).retryNormalize({
          projectId: "p1",
          datasetId: "d1",
        });

        expect(result).toEqual({ datasetId: "d1", status: "processing" });
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { status: "processing", statusError: null },
          }),
        );
        expect(enqueueDatasetNormalize).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              datasetId: "d1",
              projectId: "p1",
              tenantId: "p1",
              stagingKey: "staging/p1/k",
              filename: "data.jsonl",
            }),
          }),
        );
      });
    });

    describe("when the dataset is already ready", () => {
      it("throws DatasetNotRetryableError without enqueuing", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "ready",
            stagingKey: "staging/p1/k",
          }),
          update: vi.fn(),
        };

        await expect(
          makeService(repo).retryNormalize({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toBeInstanceOf(DatasetNotRetryableError);
        expect(enqueueDatasetNormalize).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset has no staging key", () => {
      it("throws DatasetNotRetryableError (no source to normalize)", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "failed",
            stagingKey: null,
          }),
          update: vi.fn(),
        };

        await expect(
          makeService(repo).retryNormalize({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toBeInstanceOf(DatasetNotRetryableError);
        expect(enqueueDatasetNormalize).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset has a staging key but no filename", () => {
      it("throws DatasetNotRetryableError instead of re-driving with a .jsonl guess", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "failed",
            stagingKey: "staging/p1/k",
            uploadFilename: null,
          }),
          update: vi.fn(),
        };

        await expect(
          makeService(repo).retryNormalize({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toThrow(/missing its filename/i);
        expect(enqueueDatasetNormalize).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset is archived", () => {
      it("throws DatasetNotFoundError", async () => {
        const repo = {
          findOne: vi.fn().mockResolvedValue({
            id: "d1",
            status: "failed",
            stagingKey: "staging/p1/k",
            archivedAt: new Date(),
          }),
        };

        await expect(
          makeService(repo).retryNormalize({
            projectId: "p1",
            datasetId: "d1",
          }),
        ).rejects.toThrow(/not found/i);
      });
    });
  });
});
