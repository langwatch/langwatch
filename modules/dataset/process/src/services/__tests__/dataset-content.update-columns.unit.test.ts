/**
 * @vitest-environment node
 * Editing an s3_jsonl dataset's columns answers the Dataset, not the stored row.
 */
import { datasetSchema } from "@langwatch/dataset-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../../repositories/dataset-content.repository.ts";
import type { DatasetRow } from "../../repositories/dataset.repository.ts";
import { DatasetContentService } from "../dataset-content.service.ts";

const dataset = datasetSchema.parse({
  id: "dataset_1",
  projectId: "p1",
  name: "Chunked",
  slug: "chunked",
  columnTypes: [{ name: "question", type: "string" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "s3_jsonl",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: 0,
  sizeBytes: 0n,
  chunkCount: 0,
  chunkOffsets: [],
});

describe("DatasetContentService.updateColumns", () => {
  describe("when the stored row carries an import source", () => {
    it("answers the dataset without the storage-only column", async () => {
      const columnTypes = [...dataset.columnTypes, { name: "answer", type: "string" as const }];
      const row: DatasetRow = { ...dataset, sourceStoredObjectId: "so_1" };
      const tx = createApiFixture<DatasetContentRepository>(
        {
          getOne: vi.fn(async () => row),
          updateContent: vi.fn(async () => ({ ...row, columnTypes })),
        },
        "dataset content tx",
      );
      const service = DatasetContentService.create({
        datasets: createApiFixture<DatasetContentRepository>(
          { withDatasetLock: async (_id, mutate) => mutate(tx) },
          "dataset content",
        ),
        storage: createApiFixture<DatasetChunkRepository>(
          { writeChunks: vi.fn(async () => []), deleteChunksFrom: vi.fn(async () => undefined) },
          "dataset chunks",
        ),
      });

      const updated = await service.updateColumns({
        dataset,
        projectId: "p1",
        name: dataset.name,
        slug: dataset.slug,
        columnTypes,
      });

      expect(updated.columnTypes).toEqual(columnTypes);
      expect(updated).not.toHaveProperty("sourceStoredObjectId");
    });
  });

  describe("when one save deletes a column and renames another, naming the rename", () => {
    /** @scenario "A save that deletes one column and renames another keeps the renamed column's values" */
    it("writes the renamed column's own values and drops the deleted column's", async () => {
      const before = datasetSchema.parse({
        ...dataset,
        columnTypes: [
          { name: "first", type: "string" },
          { name: "second", type: "string" },
        ],
        rowCount: 1,
        chunkCount: 1,
        chunkOffsets: [{ index: 0, startRow: 0, endRow: 1, byteSize: 10 }],
      });
      const columnTypes = [{ name: "renamed", type: "string" as const }];
      const row: DatasetRow = { ...before, sourceStoredObjectId: null };
      const writeChunks = vi.fn(async () => []);
      const tx = createApiFixture<DatasetContentRepository>(
        {
          getOne: vi.fn(async () => row),
          updateContent: vi.fn(async () => ({ ...row, columnTypes })),
        },
        "dataset content tx",
      );
      const service = DatasetContentService.create({
        datasets: createApiFixture<DatasetContentRepository>(
          { withDatasetLock: async (_id, mutate) => mutate(tx) },
          "dataset content",
        ),
        storage: createApiFixture<DatasetChunkRepository>(
          {
            readChunk: vi.fn(async () => [
              { id: "record_1", entry: { first: "deleted value", second: "kept value" } },
            ]),
            writeChunks,
            deleteChunksFrom: vi.fn(async () => undefined),
          },
          "dataset chunks",
        ),
      });

      await service.updateColumns({
        dataset: before,
        projectId: "p1",
        name: before.name,
        slug: before.slug,
        columnTypes,
        columnRenames: [{ from: "second", to: "renamed" }],
      });

      expect(writeChunks).toHaveBeenCalledWith(
        expect.objectContaining({
          records: [{ id: "record_1", entry: { renamed: "kept value" } }],
        }),
      );
    });
  });
});
