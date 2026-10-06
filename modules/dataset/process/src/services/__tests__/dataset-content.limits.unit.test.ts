/**
 * @vitest-environment node
 * A dataset stored in chunks, read and written at its size limits.
 */
import { datasetSchema, type Dataset } from "@langwatch/dataset-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../../repositories/dataset-content.repository.ts";
import { CHUNK_MAX_BYTES } from "../../rules/dataset-chunking.rules.ts";
import { DatasetContentService } from "../dataset-content.service.ts";

const row = (id: string, bytes: number) => ({ id, entry: { text: "x".repeat(bytes) } });

/** Six rows of about 1 KB each, two per chunk. */
const chunks: Record<number, unknown[]> = {
  0: [row("r1", 1000), row("r2", 1000)],
  1: [row("r3", 1000), row("r4", 1000)],
  2: [row("r5", 1000), row("r6", 1000)],
};

const dataset: Dataset = datasetSchema.parse({
  id: "dataset_1",
  projectId: "p1",
  name: "Scans",
  slug: "scans",
  columnTypes: [{ name: "text", type: "string" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "s3_jsonl",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: 6,
  sizeBytes: null,
  chunkCount: 3,
  chunkOffsets: [
    { index: 0, startRow: 0, endRow: 2 },
    { index: 1, startRow: 2, endRow: 4 },
    { index: 2, startRow: 4, endRow: 6 },
  ],
});

function content() {
  const readChunk = vi.fn(({ index }: { index: number }) => Promise.resolve(chunks[index] ?? []));
  const readChunks = vi.fn(async () => Object.values(chunks).flat());
  const storage = createApiFixture<DatasetChunkRepository>(
    { readChunk: readChunk as never, readChunks: readChunks as never },
    "dataset chunks",
  );

  return {
    readChunk,
    readChunks,
    service: DatasetContentService.create({
      datasets: createApiFixture<DatasetContentRepository>({}, "dataset content"),
      storage,
    }),
  };
}

describe("DatasetContentService at its size limits", () => {
  describe("given a dataset stored in chunks that is larger than one response carries", () => {
    describe("when every row is read under a byte budget", () => {
      /** @scenario "A read that stops early reports the same on a dataset stored in chunks" */
      it("stops at the first row that does not fit and reports the rows left out", async () => {
        const { service, readChunk, readChunks } = content();

        const read = await service.getDatasetWithRecords({
          dataset,
          projectId: "p1",
          entrySelection: "all",
          limitBytes: 3500,
        });

        expect(read.truncated).toBe(true);
        expect(read.records.map((record) => record.id)).toEqual(["r1", "r2", "r3"]);
        expect(read.totalRows).toBe(6);
        // The third chunk is never read, and the dataset is never held whole.
        expect(readChunk).toHaveBeenCalledTimes(2);
        expect(readChunks).not.toHaveBeenCalled();
      });

      it("reports nothing left out when every row fits", async () => {
        const { service } = content();

        const read = await service.getDatasetWithRecords({
          dataset,
          projectId: "p1",
          entrySelection: "all",
          limitBytes: 1024 * 1024,
        });

        expect(read).toMatchObject({ truncated: false, totalRows: 6 });
        expect(read.records).toHaveLength(6);
      });
    });
  });

  describe("given a row larger than one chunk holds", () => {
    const tooLarge = { text: "x".repeat(CHUNK_MAX_BYTES) };

    describe("when it is appended", () => {
      /** @scenario "A row too large to store after its pictures are stored is refused" */
      it("refuses the row before anything is written", async () => {
        const { service } = content();

        await expect(
          service.batchCreateRecords({
            dataset,
            input: { projectId: "p1", slugOrId: dataset.id, entries: [{ text: "ok" }, tooLarge] },
          }),
        ).rejects.toMatchObject({ code: "dataset_row_too_large", meta: { measure: "stored" } });
      });
    });

    describe("when it replaces a row", () => {
      /** @scenario "A row too large to store after its pictures are stored is refused" */
      it("refuses the row before anything is written", async () => {
        const { service } = content();

        await expect(
          service.upsertRecord({
            dataset,
            input: {
              projectId: "p1",
              slugOrId: dataset.id,
              recordId: "r1",
              updatedRecord: tooLarge,
            },
          }),
        ).rejects.toMatchObject({ code: "dataset_row_too_large", httpStatus: 413 });
      });
    });
  });
});
