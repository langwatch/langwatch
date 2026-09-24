import { datasetSchema, type Dataset, type DatasetRecord } from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetUpload } from "../../app/dataset.app.ts";
import { DatasetService } from "../../services/dataset.service.ts";
import type { DatasetRecordRepository } from "../dataset-record.repository.ts";
import type { DatasetRepository } from "../dataset.repository.ts";

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
  findAll = vi.fn(async () => []);
  create = vi.fn(async () => row());
  update = vi.fn(async () => row());
  archive = vi.fn(async () => row());
  restore = vi.fn(async () => row());
  updateMapping = vi.fn(async () => row());
  count = vi.fn(async () => 0);
}
class Records implements DatasetRecordRepository {
  async count(): Promise<number> {
    return 0;
  }
  async findByIds(): Promise<DatasetRecord[]> {
    return [];
  }

  async findPage() {
    return [];
  }
  listAll = vi.fn(async () => ({ records: [], total: 0 }));
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
      createDatasetFromStoredObject = vi.fn(async () => ({
        datasetId: "d1",
        slug: "d",
        status: "processing" as const,
      }));
      appendStoredObjectToDataset = vi.fn(async () => ({
        datasetId: "d1",
        recordsCreated: 2,
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
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    });
    await expect(
      service.appendStoredObjectToDataset({
        projectId: "p1",
        slugOrId: "d1",
        storedObjectId: "so1",
      }),
    ).resolves.toMatchObject({ datasetId: "d1", recordsCreated: 2 });
    expect(uploads.appendStoredObjectToDataset).toHaveBeenCalledOnce();
  });
});
