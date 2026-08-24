import { describe, expect, it, vi } from "vitest";
import { datasetSchema, type Dataset, type DatasetRecord } from "@langwatch/dataset-contract";
import { DatasetContentPort } from "../src/ports/dataset.port";
import { DatasetRecordRepository } from "../src/repositories/dataset-record.repository";
import { DatasetRepository } from "../src/repositories/dataset.repository";
import { DatasetService } from "../src/services/dataset.service";

const dataset = (): Dataset => datasetSchema.parse({
  id: "dataset_1", projectId: "project_1", name: "Golden Set", slug: "golden-set",
  columnTypes: [{ name: "question", type: "string" }], createdAt: new Date(), updatedAt: new Date(),
  archivedAt: null, mapping: null, useS3: false, s3RecordCount: null, contentLayout: "s3_jsonl",
  status: "ready", statusError: null, stagingKey: null, uploadFilename: null, rowCount: 2,
  sizeBytes: 20n, chunkCount: 1, chunkOffsets: [],
});

class Repo extends DatasetRepository {
  row = dataset();
  tryFindById = vi.fn(async () => this.row);
  tryFindBySlug = vi.fn(async () => null);
  list = vi.fn(async () => []);
  create = vi.fn(async () => this.row);
  update = vi.fn(async () => this.row);
  archive = vi.fn(async () => this.row);
  restore = vi.fn(async () => this.row);
  updateMapping = vi.fn(async () => this.row);
  count = vi.fn(async () => 2);
}

class Records extends DatasetRecordRepository {
  list = vi.fn(async (): Promise<{ records: DatasetRecord[]; total: number }> => ({ records: [], total: 0 }));
  createMany = vi.fn(async () => []);
  update = vi.fn(async () => { throw new Error("unused"); });
  deleteMany = vi.fn(async () => 0);
}

describe("DatasetService object-backed reads", () => {
  it("routes s3_jsonl reads through the content port", async () => {
    const content = new (class extends DatasetContentPort {
      listRecords = vi.fn(async () => ({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } }));
      getDatasetPage = vi.fn(async () => ({ id: "dataset_1", name: "Golden Set", columnTypes: [], datasetRecords: [], count: 0, page: 1, limit: 50, totalPages: 0 }));
      getDatasetWithRecords = vi.fn(async () => ({ dataset: dataset(), records: [], truncated: false }));
      getDatasetHead = vi.fn(async () => ({ dataset: dataset(), records: [], total: 0 }));
      upsertRecord = vi.fn(async () => { throw new Error("unused"); });
      batchCreateRecords = vi.fn(async () => []);
      deleteRecords = vi.fn(async () => ({ count: 0 }));
      copyDataset = vi.fn(async () => undefined);
      updateColumns = vi.fn(async () => dataset());
    })();
    const service = DatasetService.create({ repository: new Repo(), records: new Records(), content });
    await service.getDatasetWithRecords({ slugOrId: "dataset_1", projectId: "project_1", entrySelection: "all" });
    expect(content.getDatasetWithRecords).toHaveBeenCalledOnce();
  });
});
