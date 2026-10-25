/**
 * A copy writes its rows in batches that share one `createdAt`, so reads order them by id.
 * Spec: modules/dataset/specs/dataset-service.feature
 */
import { describe, expect, it } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestInlineAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

const PROJECT_ID = "project-copy-order";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Ids counting up in base62, as KSUIDs minted in one second do: byte order is minting order. */
function base62Ids(): () => string {
  let count = 0;
  return () => {
    let value = count++;
    let encoded = "";
    for (let digit = 0; digit < 4; digit++) {
      encoded = BASE62[value % 62] + encoded;
      value = Math.floor(value / 62);
    }
    return `datasetrecord_${encoded}`;
  };
}

describe("DatasetService.copyDataset", () => {
  describe("given more records than base62 has digits, written in one batch", () => {
    /** @scenario "A copied dataset lists its records in the source's order" */
    it("lists the copy in the source's order", async () => {
      const database = MemoryDatasetDatabase.create();
      const repository = MemoryDatasetRepository.create({ database });
      const records = MemoryDatasetRecordRepository.create({ database });
      const service = DatasetService.create({
        repository,
        records,
        generateId: base62Ids(),
        requestBounds: createDatasetTestRequestBounds(),
        attachments: createDatasetTestAttachments(),
        inlineAttachments: createDatasetTestInlineAttachments(),
      });
      const source = await service.upsertDataset({
        projectId: PROJECT_ID,
        name: "Ordered Questions",
        columnTypes: [{ name: "question", type: "string" }],
      });
      const entries = Array.from({ length: 62 }, (_, index) => ({
        id: `source_${String(index).padStart(3, "0")}`,
        question: `Question ${index}`,
      }));
      await records.createMany({ datasetId: source.id, projectId: PROJECT_ID, entries });

      const copy = await service.copyDataset({
        sourceDatasetId: source.id,
        sourceProjectId: PROJECT_ID,
        targetProjectId: PROJECT_ID,
      });

      const copied = await records.findPage({
        datasetId: copy.id,
        projectId: PROJECT_ID,
        limit: 100,
      });
      expect(copied.map((record) => record.entry.question)).toEqual(
        entries.map((entry) => entry.question),
      );
    });
  });
});
