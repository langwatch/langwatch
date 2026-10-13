/**
 * @vitest-environment node
 * An empty dataset stored in chunks: earlier releases record a chunk count of zero.
 */
import { datasetSchema, DatasetChunkCountMissingError } from "@langwatch/dataset-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../../repositories/dataset-content.repository.ts";
import { DatasetContentService } from "../dataset-content.service.ts";

const emptyDataset = (chunkCount: number | null) =>
  datasetSchema.parse({
    id: "dataset_1",
    projectId: "p1",
    name: "Empty",
    slug: "empty",
    columnTypes: [],
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
    sizeBytes: null,
    chunkCount,
    chunkOffsets: [],
  });

function content() {
  const readChunk = vi.fn(async (): Promise<unknown[]> => []);
  const readChunks = vi.fn(async (): Promise<unknown[]> => []);
  return {
    readChunk,
    service: DatasetContentService.create({
      datasets: createApiFixture<DatasetContentRepository>({}, "dataset content"),
      storage: createApiFixture<DatasetChunkRepository>(
        { readChunk, readChunks },
        "dataset chunks",
      ),
    }),
  };
}

describe("DatasetContentService on an empty dataset stored in chunks", () => {
  describe("given a chunk count of zero", () => {
    /** @scenario "An empty dataset stored in chunks reads as empty" */
    it("reads every record as an empty list", async () => {
      const { service, readChunk } = content();

      const read = await service.getDatasetWithRecords({
        dataset: emptyDataset(0),
        projectId: "p1",
        entrySelection: "all",
        limitBytes: 1024,
      });

      expect(read).toMatchObject({ records: [], truncated: false, totalRows: 0 });
      expect(readChunk).not.toHaveBeenCalled();
    });

    /** @scenario "An empty dataset stored in chunks reads as empty" */
    it("lists an empty first page", async () => {
      const { service } = content();

      const page = await service.listRecords({
        dataset: emptyDataset(0),
        input: { projectId: "p1", slugOrId: "dataset_1", page: 1, limit: 50 },
      });

      expect(page.data).toEqual([]);
      expect(page.pagination).toMatchObject({ total: 0, totalPages: 0 });
    });
  });

  describe("given no chunk count recorded", () => {
    /** @scenario "An empty dataset stored in chunks reads as empty" */
    it("refuses the read as drift", async () => {
      const { service } = content();

      await expect(
        service.getDatasetWithRecords({
          dataset: emptyDataset(null),
          projectId: "p1",
          entrySelection: "all",
          limitBytes: 1024,
        }),
      ).rejects.toBeInstanceOf(DatasetChunkCountMissingError);
    });
  });
});
