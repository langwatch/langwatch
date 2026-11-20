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

  describe("when a removal of every chunk stops part way and runs again", () => {
    /** @scenario "Erasing an organization removes its dataset chunks, version chunks and single files" */
    it("leaves no chunk behind, because it never opens a gap a re-run would stop at", async () => {
      const objectStorage = memoryObjectStorage();
      const chunks = ObjectStorageDatasetChunkRepository.create({ objectStorage });
      for (const index of [0, 1, 2]) {
        await chunks.writeChunks({ ...address, records: [{ index }], fromIndex: index });
      }
      const remove = objectStorage.remove.bind(objectStorage);
      let removals = 0;
      objectStorage.remove = async (at) => {
        if (++removals === 2) throw new Error("storage went away");
        return remove(at);
      };

      await expect(chunks.deleteChunksFrom({ ...address, fromIndex: 0 })).rejects.toThrow(
        "storage went away",
      );
      objectStorage.remove = remove;
      await chunks.deleteChunksFrom({ ...address, fromIndex: 0 });

      for (const index of [0, 1, 2]) {
        await expect(chunks.readChunk({ ...address, index })).rejects.toThrow(
          "Missing dataset chunk",
        );
      }
    });
  });
});
