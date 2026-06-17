import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the boundaries: the storage service (S3/local) and (via stubs) the
// repository. The service logic under test stays real.
vi.mock("../dataset-storage", () => ({ getDatasetStorage: vi.fn() }));

import { DatasetService } from "../dataset.service";
import { getDatasetStorage } from "../dataset-storage";
import { DirectUploadUnavailableError } from "../errors";
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
        });

        expect(result).toMatchObject({
          datasetId: "dataset_x",
          uploadUrl: "https://example/put",
          stagingKey: "staging/p1/u1",
        });
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "uploading",
            contentLayout: "s3_jsonl",
            projectId: "p1",
          }),
        );
      });
    });

    describe("when the backend cannot presign (self-hosted / no S3)", () => {
      it("propagates DirectUploadUnavailableError without creating a row", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          createPresignedUpload: vi
            .fn()
            .mockRejectedValue(new DirectUploadUnavailableError()),
        } as any);
        const repo = { findBySlug: vi.fn(), create: vi.fn() };

        await expect(
          makeService(repo).createPendingUpload({ projectId: "p1", name: "DS" }),
        ).rejects.toThrow(/Direct upload is unavailable/);
        expect(repo.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("finalizeUpload()", () => {
    describe("when the staged key is not under the project's prefix", () => {
      it("rejects it", async () => {
        const repo = { findOne: vi.fn().mockResolvedValue({ id: "d1" }) };
        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
            stagingKey: "staging/p2/x",
          }),
        ).rejects.toThrow(/does not belong/);
      });
    });

    describe("when the staged object exceeds the size cap", () => {
      it("marks the dataset failed and throws", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          headStagedObjectSize: vi.fn().mockResolvedValue(UPLOAD_MAX_BYTES + 1),
        } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({ id: "d1" }),
          update: vi.fn().mockResolvedValue({}),
        };
        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "d1",
            stagingKey: "staging/p1/x",
          }),
        ).rejects.toThrow(/maximum/i);
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: "failed" }),
          }),
        );
      });
    });

    describe("when the upload is within the cap", () => {
      it("flips the dataset to processing", async () => {
        vi.mocked(getDatasetStorage).mockResolvedValue({
          headStagedObjectSize: vi.fn().mockResolvedValue(1024),
        } as any);
        const repo = {
          findOne: vi.fn().mockResolvedValue({ id: "d1" }),
          update: vi.fn().mockResolvedValue({}),
        };

        const result = await makeService(repo).finalizeUpload({
          projectId: "p1",
          datasetId: "d1",
          stagingKey: "staging/p1/x",
        });

        expect(result.status).toBe("processing");
        expect(repo.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: "processing" } }),
        );
      });
    });

    describe("when the dataset does not exist", () => {
      it("throws DatasetNotFoundError", async () => {
        const repo = { findOne: vi.fn().mockResolvedValue(null) };
        await expect(
          makeService(repo).finalizeUpload({
            projectId: "p1",
            datasetId: "missing",
            stagingKey: "staging/p1/x",
          }),
        ).rejects.toThrow(/not found/i);
      });
    });
  });
});
