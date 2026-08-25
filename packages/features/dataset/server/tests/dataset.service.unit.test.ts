import { DatasetRepository } from "../src/repositories/dataset.repository";
import { DatasetRecordRepository } from "../src/repositories/dataset-record.repository";
import {
  datasetSchema,
  type Dataset,
  type DatasetRecord,
  type DatasetSummary,
  type DatasetWithRecords,
} from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";
import { DatasetService } from "../src/services/dataset.service";
import {
  DatasetContentPort,
  DatasetNormalizeQueuePort,
  DatasetUploadPort,
} from "../src/ports/dataset.port";
import type {
  FinalizeUploadInput,
  RetryNormalizeInput,
} from "@langwatch/dataset-contract";

const makeDataset = (overrides: Partial<Dataset> = {}): Dataset =>
  datasetSchema.parse({
    id: "dataset_1",
    projectId: "project_1",
    name: "Golden Set",
    slug: "golden-set",
    columnTypes: [{ name: "question", type: "string" }],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
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
    ...overrides,
  });

class MemoryDatasetRepository extends DatasetRepository {
  dataset = makeDataset();
  async tryFindById(input: { id: string; projectId: string }): Promise<Dataset | null> {
    return this.dataset.id === input.id && this.dataset.projectId === input.projectId
      ? this.dataset
      : null;
  }
  async tryFindBySlug(input: {
    slug: string;
    projectId: string;
  }): Promise<Dataset | null> {
    return this.dataset.slug === input.slug && this.dataset.projectId === input.projectId
      ? this.dataset
      : null;
  }
  async list(): Promise<DatasetSummary[]> {
    return [{ ...this.dataset, recordCount: 0 }];
  }
  async create(input: {
    projectId: string;
    name: string;
    slug: string;
    columnTypes: Dataset["columnTypes"];
  }): Promise<Dataset> {
    this.dataset = makeDataset({
      id: "dataset_new",
      projectId: input.projectId,
      name: input.name,
      slug: input.slug,
      columnTypes: input.columnTypes,
    });
    return this.dataset;
  }
  async update(input: {
    id: string;
    projectId: string;
    name: string;
    slug: string;
    columnTypes: Dataset["columnTypes"];
  }): Promise<Dataset> {
    this.dataset = makeDataset({ ...this.dataset, ...input });
    return this.dataset;
  }
  async archive(input: {
    id: string;
    projectId: string;
    slug: string;
    archivedAt: Date | null;
  }): Promise<Dataset> {
    this.dataset = makeDataset({ ...this.dataset, ...input });
    return this.dataset;
  }
  async restore(input: {
    id: string;
    projectId: string;
    slug: string;
  }): Promise<Dataset> {
    this.dataset = makeDataset({ ...this.dataset, ...input, archivedAt: null });
    return this.dataset;
  }
  async updateMapping(input: {
    id: string;
    projectId: string;
    mapping: Record<string, unknown>;
  }): Promise<Dataset> {
    this.dataset = makeDataset({ ...this.dataset, mapping: input.mapping });
    return this.dataset;
  }
  async count(): Promise<number> {
    return 0;
  }
}

class MemoryRecordRepository extends DatasetRecordRepository {
  records: DatasetRecord[] = [];
  async list(): Promise<{ records: DatasetRecord[]; total: number }> {
    return { records: this.records, total: this.records.length };
  }
  async createMany(input: {
    datasetId: string;
    projectId: string;
    entries: Array<Record<string, unknown> & { id: string }>;
  }): Promise<DatasetRecord[]> {
    this.records = input.entries.map((entry) => ({
      id: entry.id,
      datasetId: input.datasetId,
      projectId: input.projectId,
      entry,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    }));
    return this.records;
  }
  async update(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
  }): Promise<DatasetRecord> {
    const record = this.records.find((candidate) => candidate.id === input.id);
    if (!record) throw new Error("Dataset record not found");
    record.entry = input.entry;
    return record;
  }
  async deleteMany(): Promise<number> {
    const count = this.records.length;
    this.records = [];
    return count;
  }
}

describe("DatasetService", () => {
  it("creates records through the Dataset boundary", async () => {
    const repository = new MemoryDatasetRepository();
    const records = new MemoryRecordRepository();
    const service = DatasetService.create({
      repository,
      records,
      generateId: () => "record_1",
    });

    const dataset = await service.upsertDataset({
      projectId: "project_1",
      name: "New Set",
      columnTypes: [{ name: "question", type: "string" }],
      datasetRecords: [{ question: "hello" }],
    });

    expect(dataset.slug).toBe("new-set");
    expect(records.records[0]?.id).toBe("record_1");
  });

  it("rejects writes to a dataset that is not ready", async () => {
    const repository = new MemoryDatasetRepository();
    repository.dataset = makeDataset({ status: "processing" });
    const service = DatasetService.create({
      repository,
      records: new MemoryRecordRepository(),
    });

    await expect(
      service.createRecords({
        slugOrId: "dataset_1",
        projectId: "project_1",
        entries: [{ question: "hello" }],
      }),
    ).rejects.toThrow("Dataset is not ready");
  });

  it("routes object-backed reads and mutations through the content port", async () => {
    const repository = new MemoryDatasetRepository();
    repository.dataset = makeDataset({
      contentLayout: "s3_jsonl",
      rowCount: 1,
      chunkCount: 1,
      chunkOffsets: [],
    });
    const records = new MemoryRecordRepository();
    const calls: string[] = [];
    class MemoryContentPort extends DatasetContentPort {
      async listRecords(): Promise<never> {
        calls.push("list");
        throw new Error("not used");
      }
      async getDatasetPage(): Promise<never> {
        calls.push("page");
        throw new Error("not used");
      }
      async getDatasetWithRecords(input: {
        dataset: Dataset;
      }): Promise<DatasetWithRecords> {
        calls.push(`read:${input.dataset.id}`);
        return { dataset: input.dataset, records: [], truncated: false };
      }
      async getDatasetHead(): Promise<never> {
        calls.push("head");
        throw new Error("not used");
      }
      async upsertRecord(): Promise<never> {
        calls.push("upsert");
        throw new Error("not used");
      }
      async batchCreateRecords(): Promise<never> {
        calls.push("batch");
        throw new Error("not used");
      }
      async deleteRecords(): Promise<never> {
        calls.push("delete");
        throw new Error("not used");
      }
      async copyDataset(): Promise<void> {
        calls.push("copy");
      }
      async updateColumns(): Promise<never> {
        calls.push("columns");
        throw new Error("not used");
      }
    }
    const service = DatasetService.create({
      repository,
      records,
      content: new MemoryContentPort(),
    });

    const result = await service.getDatasetWithRecords({
      slugOrId: repository.dataset.id,
      projectId: repository.dataset.projectId,
      entrySelection: "all",
      limitMb: 5,
    });

    expect(result.records).toEqual([]);
    expect(calls).toEqual(["read:dataset_1"]);
  });

  it("enqueues normalization after upload finalization through the queue port", async () => {
    const repository = new MemoryDatasetRepository();
    const records = new MemoryRecordRepository();
    const queueCalls: Array<{ projectId: string; datasetId: string }> = [];
    class Uploads extends DatasetUploadPort {
      async finalizeUpload(
        input: FinalizeUploadInput,
      ): Promise<{ datasetId: string; status: "processing" }> {
        return { datasetId: input.datasetId, status: "processing" };
      }
      async retryNormalize(
        input: RetryNormalizeInput,
      ): Promise<{ datasetId: string; status: "processing" }> {
        return { datasetId: input.datasetId, status: "processing" };
      }
      async uploadToExistingDataset(): Promise<{
        datasetId: string;
        recordsCreated: number;
      }> {
        return { datasetId: "d", recordsCreated: 0 };
      }
      async createDatasetFromUpload(): Promise<never> {
        throw new Error("unused");
      }
      async createPendingUpload(): Promise<never> {
        throw new Error("unused");
      }
      async writeStagedUpload(): Promise<void> {
        return;
      }
      async abortPendingUpload(): Promise<never> {
        throw new Error("unused");
      }
    }
    class Queue extends DatasetNormalizeQueuePort {
      async enqueueNormalize(input: {
        projectId: string;
        datasetId: string;
      }): Promise<void> {
        queueCalls.push(input);
      }
    }
    const service = DatasetService.create({
      repository,
      records,
      uploads: new Uploads(),
      queue: new Queue(),
    });

    await service.finalizeUpload({ projectId: "project_1", datasetId: "dataset_1" });
    await service.retryNormalize({ projectId: "project_1", datasetId: "dataset_1" });
    expect(queueCalls).toEqual([
      { projectId: "project_1", datasetId: "dataset_1" },
      { projectId: "project_1", datasetId: "dataset_1" },
    ]);
  });
});
