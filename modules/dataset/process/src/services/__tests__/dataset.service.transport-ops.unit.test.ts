/**
 * @vitest-environment node
 */
import { BadRequestError, NotFoundError } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

function service(): DatasetService {
  return serviceOver({ database: MemoryDatasetDatabase.create() });
}

function serviceOver({ database }: { database: MemoryDatasetDatabase }): DatasetService {
  return DatasetService.create({
    repository: MemoryDatasetRepository.create({ database }),
    records: MemoryDatasetRecordRepository.create({ database }),
    generateId: () => "generated-id",
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
  });
}

const whole = {
  dataset: { id: "dataset-1", name: "One", slug: "one", columnTypes: [] },
  records: [],
};

describe("DatasetService operations the transports call", () => {
  describe("when a whole dataset is read under a ceiling", () => {
    it("answers the read when it fits", async () => {
      const datasets = service();
      vi.spyOn(datasets, "getDatasetWithRecords").mockResolvedValue({
        ...whole,
        truncated: false,
      } as never);

      await expect(
        datasets.getDatasetWithinLimit({ slugOrId: "one", projectId: "p", limitMb: 25 }),
      ).resolves.toMatchObject({ truncated: false });
    });

    it("refuses rather than truncating when the read exceeds the ceiling", async () => {
      const datasets = service();
      vi.spyOn(datasets, "getDatasetWithRecords").mockResolvedValue({
        ...whole,
        truncated: true,
      } as never);

      await expect(
        datasets.getDatasetWithinLimit({ slugOrId: "one", projectId: "p", limitMb: 25 }),
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("when a batch delete matches no entry", () => {
    it("answers 404 rather than reporting nothing was deleted", async () => {
      const datasets = service();
      vi.spyOn(datasets, "deleteRecords").mockResolvedValue({ count: 0 });

      await expect(
        datasets.deleteMatchingRecords({ slugOrId: "one", projectId: "p", recordIds: ["r"] }),
      ).rejects.toThrow(NotFoundError);
    });

    it("answers how many it removed when some matched", async () => {
      const datasets = service();
      vi.spyOn(datasets, "deleteRecords").mockResolvedValue({ count: 2 });

      await expect(
        datasets.deleteMatchingRecords({ slugOrId: "one", projectId: "p", recordIds: ["r"] }),
      ).resolves.toEqual({ deletedCount: 2 });
    });
  });

  describe("when a dataset is deleted from the list", () => {
    /** @scenario "Undoing an archive restores the slug the dataset kept" */
    it("archives it, and restores it when the caller undoes", async () => {
      const database = MemoryDatasetDatabase.create();
      const { id } = await MemoryDatasetRepository.create({ database }).create({
        projectId: "p",
        name: "One",
        slug: "one",
        columnTypes: [],
      });
      const datasets = serviceOver({ database });
      const archive = vi
        .spyOn(datasets, "archiveDataset")
        .mockResolvedValue({ id, archived: true });
      const restore = vi.spyOn(datasets, "restoreDataset").mockResolvedValue({ success: true });

      await datasets.archiveOrRestoreDataset({ projectId: "p", datasetId: id });
      await datasets.archiveOrRestoreDataset({ projectId: "p", datasetId: id, undo: true });

      expect(archive).toHaveBeenCalledWith({ slugOrId: id, projectId: "p" });
      expect(restore).toHaveBeenCalledWith({ datasetId: id, projectId: "p" });
    });
  });
});
