import {
  datasetSchema,
  type Dataset,
  type DatasetWithRecords,
  type CreateDatasetFromStoredObjectInput,
  type DatasetImportStarted,
  type RetryNormalizeInput,
} from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import type {
  DatasetContent,
  DatasetNormalizeQueue,
  DatasetUpload,
} from "../../app/dataset.app.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

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

function seeded(overrides: Partial<Dataset> = {}) {
  const database = MemoryDatasetDatabase.create();
  database.putDataset({ ...makeDataset(overrides), sourceStoredObjectId: null });
  return {
    database,
    dataset: makeDataset(overrides),
    repository: MemoryDatasetRepository.create({ database }),
    records: MemoryDatasetRecordRepository.create({ database }),
  };
}

describe("DatasetService", () => {
  it("creates records through the Dataset boundary", async () => {
    const { database, repository, records } = seeded();
    const service = DatasetService.create({
      repository,
      records,
      generateId: () => "record_1",
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    });

    const dataset = await service.upsertDataset({
      projectId: "project_1",
      name: "New Set",
      columnTypes: [{ name: "question", type: "string" }],
      datasetRecords: [{ question: "hello" }],
    });

    expect(dataset.slug).toBe("new-set");
    expect(database.records().map((record) => record.id)).toEqual(["record_1"]);
  });

  it("rejects writes to a dataset that is not ready", async () => {
    const { repository, records } = seeded({ status: "processing" });
    const service = DatasetService.create({
      repository,
      records,
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    });

    await expect(
      service.createRecords({
        slugOrId: "dataset_1",
        projectId: "project_1",
        entries: [{ question: "hello" }],
      }),
    ).rejects.toThrow("Dataset is not ready");
  });

  /** @scenario "Dataset access is isolated to its own project" */
  it("refuses to read or write a dataset from another project", async () => {
    const { repository, records } = seeded({ projectId: "project_1" });
    const service = DatasetService.create({
      repository,
      records,
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    });

    await expect(
      service.listRecords({ slugOrId: "dataset_1", projectId: "project_2" }),
    ).rejects.toMatchObject({ code: "dataset_not_found" });
    await expect(
      service.createRecords({
        slugOrId: "dataset_1",
        projectId: "project_2",
        entries: [{ question: "hello" }],
      }),
    ).rejects.toMatchObject({ code: "dataset_not_found" });
  });

  /** @scenario "A dataset still being prepared is not used as data" */
  it("refuses to list records from a dataset that is still processing", async () => {
    const { repository, records } = seeded({ status: "processing" });
    const service = DatasetService.create({
      repository,
      records,
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    });

    await expect(
      service.listRecords({ slugOrId: "dataset_1", projectId: "project_1" }),
    ).rejects.toThrow("Dataset is not ready");
  });

  it("routes object-backed reads and mutations through the content port", async () => {
    const { dataset, repository, records } = seeded({
      contentLayout: "s3_jsonl",
      rowCount: 1,
      chunkCount: 1,
      chunkOffsets: [],
    });
    const calls: string[] = [];
    class MemoryContent implements DatasetContent {
      async findEntries(): Promise<Record<string, unknown>[]> {
        return [];
      }

      async searchRecords(): Promise<never> {
        throw new Error("not configured");
      }
      async listRecords(): Promise<never> {
        calls.push("list");
        throw new Error("not used");
      }
      async getDatasetPage(): Promise<never> {
        calls.push("page");
        throw new Error("not used");
      }
      async getDatasetWithRecords(input: { dataset: Dataset }): Promise<DatasetWithRecords> {
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
      content: new MemoryContent(),
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    });

    const result = await service.getDatasetWithRecords({
      slugOrId: dataset.id,
      projectId: dataset.projectId,
      entrySelection: "all",
      limitMb: 5,
    });

    expect(result.records).toEqual([]);
    expect(calls).toEqual(["read:dataset_1"]);
  });

  it("enqueues normalization after a stored-object import through the queue port", async () => {
    const { repository, records } = seeded();
    const queueCalls: { projectId: string; datasetId: string }[] = [];
    class Uploads implements DatasetUpload {
      async createDatasetFromStoredObject(
        input: CreateDatasetFromStoredObjectInput,
      ): Promise<DatasetImportStarted> {
        return { datasetId: "dataset_1", slug: input.name, status: "processing" };
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
      async appendStoredObjectToDataset(): Promise<never> {
        throw new Error("unused");
      }
    }
    class Queue implements DatasetNormalizeQueue {
      async enqueueNormalize(input: { projectId: string; datasetId: string }): Promise<void> {
        queueCalls.push(input);
      }
    }
    const service = DatasetService.create({
      repository,
      records,
      uploads: new Uploads(),
      queue: new Queue(),
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    });

    await service.createDatasetFromStoredObject({
      projectId: "project_1",
      name: "dataset_1",
      storedObjectId: "stored_object_1",
    });
    await service.retryNormalize({ projectId: "project_1", datasetId: "dataset_1" });
    expect(queueCalls).toEqual([
      { projectId: "project_1", datasetId: "dataset_1" },
      { projectId: "project_1", datasetId: "dataset_1" },
    ]);
  });
});
