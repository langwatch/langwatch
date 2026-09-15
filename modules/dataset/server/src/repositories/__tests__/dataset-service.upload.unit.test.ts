import { describe, expect, it, vi } from "vitest";
import { datasetSchema, type Dataset } from "@langwatch/dataset-contract";
import type { DatasetRecordRepository } from "../dataset-record.repository.ts";
import type { DatasetRepository } from "../dataset.repository.ts";
import { DatasetService } from "../../services/dataset.service.ts";
import { DatasetUpload } from "../../app/dataset.app.ts";

const row = (): Dataset =>
  datasetSchema.parse({
    id: "d1",
    projectId: "p1",
    name: "D",
    slug: "d",
    columnTypes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    mapping: null,
    useS3: false,
    s3RecordCount: null,
    contentLayout: "postgres",
    status: "ready",
    statusError: null,
    stagingKey: null,
    uploadFilename: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
  });
class Repo implements DatasetRepository {
  findById = vi.fn(async () => row());
  findBySlug = vi.fn(async () => row());
  list = vi.fn(async () => []);
  create = vi.fn(async () => row());
  update = vi.fn(async () => row());
  archive = vi.fn(async () => row());
  restore = vi.fn(async () => row());
  updateMapping = vi.fn(async () => row());
  count = vi.fn(async () => 0);
}
class Records implements DatasetRecordRepository {
  list = vi.fn(async () => ({ records: [], total: 0 }));
  createMany = vi.fn(async () => []);
  update = vi.fn(async () => {
    throw new Error("unused");
  });
  deleteMany = vi.fn(async () => 0);
}

describe("DatasetService upload boundary", () => {
  it("delegates upload operations to the injected upload port", async () => {
    const uploads = new (class implements DatasetUpload {
      uploadToExistingDataset = vi.fn(async () => ({
        datasetId: "d1",
        recordsCreated: 2,
      }));
      createDatasetFromUpload = vi.fn(async () => ({
        id: "d1",
        name: "D",
        slug: "d",
        columnTypes: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        recordsCreated: 2,
      }));
      createPendingUpload = vi.fn(async () => ({
        datasetId: "d1",
        slug: "d",
        uploadUrl: "https://example/upload",
      }));
      writeStagedUpload = vi.fn(async () => undefined);
      abortPendingUpload = vi.fn(async () => ({
        datasetId: "d1",
        aborted: true as const,
      }));
      finalizeUpload = vi.fn(async () => ({
        datasetId: "d1",
        status: "processing" as const,
      }));
      retryNormalize = vi.fn(async () => ({
        datasetId: "d1",
        status: "processing" as const,
      }));
    })();
    const service = DatasetService.create({
      repository: new Repo(),
      records: new Records(),
      uploads,
    });
    await expect(
      service.createPendingUpload({ projectId: "p1", name: "D", filename: "d.csv" }),
    ).resolves.toMatchObject({ datasetId: "d1" });
    expect(uploads.createPendingUpload).toHaveBeenCalledOnce();
  });
});
