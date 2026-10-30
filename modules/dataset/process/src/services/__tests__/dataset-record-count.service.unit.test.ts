/**
 * Entry counts are a second read beside the dataset list: only datasets kept in
 * the entries table are counted there; the rest answer from their stored count.
 * @see specs/datasets/datasets-list-page.feature
 */
import { datasetSchema, type Dataset } from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestInlineAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetRecordCountService } from "../dataset-record-count.service.ts";
import { DatasetService } from "../dataset.service.ts";

const PROJECT_ID = "project_1";

const makeDataset = (overrides: Partial<Dataset> & { id: string }): Dataset =>
  datasetSchema.parse({
    projectId: PROJECT_ID,
    name: overrides.id,
    slug: overrides.id,
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

function seeded({ datasets, entries }: { datasets: Dataset[]; entries: Record<string, number> }) {
  const database = MemoryDatasetDatabase.create();
  for (const dataset of datasets) database.putDataset({ ...dataset, sourceStoredObjectId: null });
  for (const [datasetId, count] of Object.entries(entries)) {
    const projectId = datasets.find((dataset) => dataset.id === datasetId)?.projectId ?? PROJECT_ID;
    for (let index = 0; index < count; index++) {
      database.putRecord({
        id: `${datasetId}-record-${index}`,
        datasetId,
        projectId,
        entry: { question: `q${index}` },
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      });
    }
  }
  const repository = MemoryDatasetRepository.create({ database });
  const records = MemoryDatasetRecordRepository.create({ database });
  return { repository, records };
}

describe("DatasetRecordCountService", () => {
  describe("given a project mixing entries-table datasets with object-storage ones", () => {
    const stores = () =>
      seeded({
        datasets: [
          makeDataset({ id: "in-table" }),
          makeDataset({ id: "empty" }),
          makeDataset({ id: "chunked", contentLayout: "s3_jsonl", rowCount: 12_345 }),
          makeDataset({ id: "legacy-blob", useS3: true, s3RecordCount: 77 }),
        ],
        entries: { "in-table": 4 },
      });

    describe("when their entries are counted", () => {
      /** @scenario "Entry counts arrive after the list" */
      it("gives every dataset its own count, zero for one holding none", async () => {
        const { repository, records } = stores();
        const service = DatasetRecordCountService.create({ datasets: repository, records });

        const counts = await service.countRecords({
          projectId: PROJECT_ID,
          datasetIds: ["in-table", "empty", "chunked", "legacy-blob"],
        });

        expect(counts.toSorted((a, b) => a.datasetId.localeCompare(b.datasetId))).toEqual([
          { datasetId: "chunked", recordCount: 12_345 },
          { datasetId: "empty", recordCount: 0 },
          { datasetId: "in-table", recordCount: 4 },
          { datasetId: "legacy-blob", recordCount: 77 },
        ]);
      });

      /** @scenario "Datasets kept in object storage never have their entries counted" */
      it("asks the entries table only about the datasets kept there, in one read", async () => {
        const { repository, records } = stores();
        const countByDataset = vi.spyOn(records, "countByDataset");
        const service = DatasetRecordCountService.create({ datasets: repository, records });

        await service.countRecords({
          projectId: PROJECT_ID,
          datasetIds: ["in-table", "empty", "chunked", "legacy-blob"],
        });

        expect(countByDataset).toHaveBeenCalledTimes(1);
        expect(countByDataset.mock.calls[0]?.[0].datasetIds.toSorted()).toEqual([
          "empty",
          "in-table",
        ]);
      });
    });
  });

  describe("given a dataset in another project", () => {
    describe("when my project's counts are asked for it by id", () => {
      it("answers nothing for it", async () => {
        const { repository, records } = seeded({
          datasets: [makeDataset({ id: "theirs", projectId: "project_2" })],
          entries: { theirs: 3 },
        });
        const service = DatasetRecordCountService.create({ datasets: repository, records });

        await expect(
          service.countRecords({ projectId: PROJECT_ID, datasetIds: ["theirs"] }),
        ).resolves.toEqual([]);
      });
    });
  });

  describe("given an archived dataset", () => {
    describe("when its count is asked for by id", () => {
      it("answers nothing for it", async () => {
        const { repository, records } = seeded({
          datasets: [makeDataset({ id: "archived", archivedAt: new Date("2026-02-01") })],
          entries: { archived: 3 },
        });
        const service = DatasetRecordCountService.create({ datasets: repository, records });

        await expect(
          service.countRecords({ projectId: PROJECT_ID, datasetIds: ["archived"] }),
        ).resolves.toEqual([]);
      });
    });
  });

  describe("given entries were added to a dataset after it was counted", () => {
    describe("when its entries are counted again", () => {
      /** @scenario "An entry count refreshes after records are added" */
      it("answers the new count", async () => {
        const { repository, records } = seeded({
          datasets: [makeDataset({ id: "growing" })],
          entries: { growing: 1 },
        });
        const service = DatasetRecordCountService.create({ datasets: repository, records });
        await service.countRecords({ projectId: PROJECT_ID, datasetIds: ["growing"] });

        await records.createMany({
          datasetId: "growing",
          projectId: PROJECT_ID,
          entries: [{ id: "added", question: "new" }],
        });

        await expect(
          service.countRecords({ projectId: PROJECT_ID, datasetIds: ["growing"] }),
        ).resolves.toEqual([{ datasetId: "growing", recordCount: 2 }]);
      });
    });
  });
});

describe("DatasetService.listDatasets", () => {
  describe("given a dataset whose rows were prepared from an uploaded file", () => {
    /** @scenario "List datasets counts the rows of a dataset built from an uploaded file" */
    it("answers the number of rows the file held", async () => {
      const { repository, records } = seeded({
        datasets: [makeDataset({ id: "uploaded", contentLayout: "s3_jsonl", rowCount: 10 })],
        entries: {},
      });
      const service = DatasetService.create({
        repository,
        records,
        requestBounds: createDatasetTestRequestBounds(),
        attachments: createDatasetTestAttachments(),
        inlineAttachments: createDatasetTestInlineAttachments(),
      });

      const page = await service.listDatasets({ projectId: PROJECT_ID });

      expect(page.data.map(({ id, recordCount }) => ({ id, recordCount }))).toEqual([
        { id: "uploaded", recordCount: 10 },
      ]);
    });
  });

  describe("given the browser's list surfaces", () => {
    /** @scenario "The list shows before entry counts arrive" */
    it("answers the page without counting any entries", async () => {
      const { repository, records } = seeded({
        datasets: [makeDataset({ id: "listed" })],
        entries: { listed: 2 },
      });
      const countByDataset = vi.spyOn(records, "countByDataset");
      const service = DatasetService.create({
        repository,
        records,
        requestBounds: createDatasetTestRequestBounds(),
        attachments: createDatasetTestAttachments(),
        inlineAttachments: createDatasetTestInlineAttachments(),
      });

      const summaries = await service.findDatasetSummaries({ projectId: PROJECT_ID });

      expect(summaries.map(({ id }) => id)).toEqual(["listed"]);
      expect(summaries[0]).not.toHaveProperty("recordCount");
      expect(countByDataset).not.toHaveBeenCalled();
    });
  });
});
