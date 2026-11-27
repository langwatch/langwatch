/** @vitest-environment node */
import { memoryObjectStorage } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { ObjectStorageDatasetChunkRepository } from "../object-storage.dataset-chunk.repository.ts";

const address = { projectId: "project-1", datasetId: "dataset-1" };

describe("ObjectStorageDatasetChunkRepository", () => {
  describe("when a scan reads a chunk with its measure", () => {
    /** @scenario A search counts the bytes storage handed it, not a re-encoding of the rows */
    it("answers the rows with the bytes of the JSONL file storage held", async () => {
      const chunks = ObjectStorageDatasetChunkRepository.create({
        objectStorage: memoryObjectStorage(),
      });
      const records = [{ text: "é€𝄞" }, { text: "plain" }];
      const [written] = await chunks.writeChunks({ ...address, records });

      const read = await chunks.readMeasuredChunk({ ...address, index: 0 });

      expect(read.rows).toEqual(records);
      expect(read.byteSize).toBe(written?.byteSize);
      expect(read.byteSize).not.toBe(Buffer.byteLength(JSON.stringify(records)));
    });
  });
});
