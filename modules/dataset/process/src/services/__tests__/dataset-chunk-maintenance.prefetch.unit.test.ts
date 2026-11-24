import { memoryObjectStorage } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../../repositories/dataset-content.repository.ts";
import { ObjectStorageDatasetChunkRepository } from "../../repositories/object-storage/object-storage.dataset-chunk.repository.ts";
import type { DatasetMutationRecord } from "../../rules/dataset-chunk-lines.rules.ts";
import { CHUNK_MAX_BYTES } from "../../rules/dataset-chunking.rules.ts";
import { DatasetChunkMaintenanceService } from "../dataset-chunk-maintenance.service.ts";

const projectId = "project_edit";
const datasetId = "dataset_edit";
const columnTypes = [{ name: "n", type: "string" as const }];
const CHUNKS = 12;

/** One-row chunks over memory storage whose reads are counted while in flight. */
async function countedChunks() {
  const chunks = ObjectStorageDatasetChunkRepository.create({
    objectStorage: memoryObjectStorage(),
  });
  for (let index = 0; index < CHUNKS; index++) {
    await chunks.writeChunks({
      projectId,
      datasetId,
      records: [{ id: `row_${index}`, entry: { n: `${index}` } }],
      fromIndex: index,
    });
  }
  const seen = { inFlight: 0, most: 0 };
  const storage: DatasetChunkRepository = Object.assign(Object.create(chunks), {
    readChunk: async (input: { projectId: string; datasetId: string; index: number }) => {
      seen.inFlight += 1;
      seen.most = Math.max(seen.most, seen.inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await chunks.readChunk(input);
      } finally {
        seen.inFlight -= 1;
      }
    },
  });
  return { storage, seen };
}

const recordWith = (byteSize: number): DatasetMutationRecord => ({
  id: datasetId,
  status: "ready",
  statusError: null,
  chunkCount: CHUNKS,
  chunkOffsets: Array.from({ length: CHUNKS }, (_, index) => ({
    index,
    startRow: index,
    endRow: index + 1,
    byteSize,
  })),
  rowCount: CHUNKS,
  sizeBytes: 1024n,
  columnTypes,
});

describe("DatasetChunkMaintenanceService.migrateColumns", () => {
  describe("when the chunks grew to the size limit after the edit loaded its record", () => {
    /** @scenario "A column edit sizes its read ahead from the dataset as it stands under the lock" */
    it("reads ahead by the sizes recorded under the lock, one full-size chunk at a time", async () => {
      const { storage, seen } = await countedChunks();
      const current = recordWith(CHUNK_MAX_BYTES);
      const tx = createApiFixture<DatasetContentRepository>(
        {
          getOne: async () => current as never,
          updateContent: async () => current as never,
        },
        "dataset content tx",
      );
      const maintenance = DatasetChunkMaintenanceService.create({
        datasets: createApiFixture<DatasetContentRepository>(
          { withDatasetLock: async (_id, mutate) => mutate(tx) },
          "dataset content",
        ),
      });

      await maintenance.migrateColumns({
        dataset: recordWith(1),
        projectId,
        oldColumnTypes: columnTypes,
        newColumnTypes: columnTypes,
        name: "Edit",
        slug: "edit",
        storage,
      });

      expect(seen.most).toBe(1);
    });
  });
});
