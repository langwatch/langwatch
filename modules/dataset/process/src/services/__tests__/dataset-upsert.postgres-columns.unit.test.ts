/**
 * A column edit on a dataset whose records live in Postgres rewrites each
 * record's keys, the same way the chunked layout does.
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
import { DatasetService } from "../dataset.service.ts";

const dataset: Dataset = datasetSchema.parse({
  id: "dataset_1",
  projectId: "project_1",
  name: "Support Set",
  slug: "support-set",
  columnTypes: [
    { name: "input", type: "string" },
    { name: "expected_output", type: "string" },
  ],
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
});

async function seeded() {
  const database = MemoryDatasetDatabase.create();
  database.putDataset({ ...dataset, sourceStoredObjectId: null });
  const records = MemoryDatasetRecordRepository.create({ database });
  await records.createMany({
    datasetId: dataset.id,
    projectId: dataset.projectId,
    entries: [
      { id: "rec_1", input: "How do I pay?", expected_output: "Open Billing." },
      { id: "rec_2", input: "Opening hours?", expected_output: "Nine to six." },
    ],
  });
  const service = DatasetService.create({
    repository: MemoryDatasetRepository.create({ database }),
    records,
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
    inlineAttachments: createDatasetTestInlineAttachments(),
  });
  const entries = async () =>
    (
      await records.findPage({ datasetId: dataset.id, projectId: dataset.projectId, limit: 10 })
    ).map((record) => ({ id: record.id, ...record.entry }));
  const stored = () => database.getDataset(dataset.projectId, dataset.id).columnTypes;
  return { service, records, entries, stored };
}

const original = [
  { id: "rec_1", input: "How do I pay?", expected_output: "Open Billing." },
  { id: "rec_2", input: "Opening hours?", expected_output: "Nine to six." },
];

describe("given a dataset whose records are stored in Postgres", () => {
  describe("when one save deletes a column and renames another", () => {
    /** @scenario "A save that deletes one column and renames another keeps the renamed column's values" */
    it("moves the renamed column's values and drops the deleted column's", async () => {
      const { service, entries } = await seeded();

      await service.upsertDataset({
        projectId: dataset.projectId,
        datasetId: dataset.id,
        name: dataset.name,
        columnTypes: [{ name: "reference", type: "string" }],
        columnRenames: [{ from: "expected_output", to: "reference" }],
      });

      expect(await entries()).toEqual([
        { id: "rec_1", reference: "Open Billing." },
        { id: "rec_2", reference: "Nine to six." },
      ]);
    });
  });

  describe("when a save renames a column without naming the rename", () => {
    /** @scenario "A save that deletes one column and renames another keeps the renamed column's values" */
    it("pairs the leftover columns by position, as the chunked layout does", async () => {
      const { service, entries } = await seeded();

      await service.upsertDataset({
        projectId: dataset.projectId,
        datasetId: dataset.id,
        name: dataset.name,
        columnTypes: [
          { name: "input", type: "string" },
          { name: "answer", type: "string" },
        ],
      });

      expect(await entries()).toEqual([
        { id: "rec_1", input: "How do I pay?", answer: "Open Billing." },
        { id: "rec_2", input: "Opening hours?", answer: "Nine to six." },
      ]);
    });
  });

  describe("when a save only retypes, reorders and adds columns", () => {
    /** @scenario "A column edit that moves no values leaves the stored records untouched" */
    it("stores the new columns and rewrites no record", async () => {
      const { service, records, entries, stored } = await seeded();
      const replaceAll = vi.spyOn(records, "replaceAll");
      const columnTypes = [
        { name: "expected_output", type: "string" },
        { name: "input", type: "json" },
        { name: "notes", type: "string" },
      ] as const;

      await service.upsertDataset({
        projectId: dataset.projectId,
        datasetId: dataset.id,
        name: dataset.name,
        columnTypes: [...columnTypes],
      });

      expect(replaceAll).not.toHaveBeenCalled();
      expect(stored()).toEqual(columnTypes);
      expect(await entries()).toEqual(original);
    });
  });

  describe("when a save names a rename that does not match the dataset", () => {
    const keepsInput = [
      { name: "input", type: "string" },
      { name: "reference", type: "string" },
    ] as const;

    /** @scenario "A column rename that does not match the dataset is refused" */
    it.each([
      ["a column the dataset lacks", [{ from: "typo", to: "reference" }]],
      ["a column the save lacks", [{ from: "expected_output", to: "answer" }]],
      [
        "a column in two renames",
        [
          { from: "expected_output", to: "reference" },
          { from: "expected_output", to: "input" },
        ],
      ],
    ])("refuses a rename naming %s and changes nothing", async (_case, columnRenames) => {
      const { service, entries, stored } = await seeded();

      await expect(
        service.upsertDataset({
          projectId: dataset.projectId,
          datasetId: dataset.id,
          name: dataset.name,
          columnTypes: [...keepsInput],
          columnRenames,
        }),
      ).rejects.toMatchObject({ code: "validation_error" });

      expect(stored()).toEqual(dataset.columnTypes);
      expect(await entries()).toEqual(original);
    });
  });
});
