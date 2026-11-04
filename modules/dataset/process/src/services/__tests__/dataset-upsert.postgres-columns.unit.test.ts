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
  const repository = MemoryDatasetRepository.create({ database });
  const service = DatasetService.create({
    repository,
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
  return { service, records, repository, database, entries, stored };
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

  describe("when a save swaps two column names and keeps the column list", () => {
    it("swaps the stored values", async () => {
      const { service, entries } = await seeded();

      await service.upsertDataset({
        projectId: dataset.projectId,
        datasetId: dataset.id,
        name: dataset.name,
        columnTypes: dataset.columnTypes,
        columnRenames: [
          { from: "input", to: "expected_output" },
          { from: "expected_output", to: "input" },
        ],
      });

      expect(await entries()).toEqual([
        { id: "rec_1", expected_output: "How do I pay?", input: "Open Billing." },
        { id: "rec_2", expected_output: "Opening hours?", input: "Nine to six." },
      ]);
    });
  });

  describe("when another column edit commits right after this one releases the lock", () => {
    /** @scenario "A dataset save does not undo a column edit that committed while it ran" */
    it("keeps the later edit's columns: the name update writes no columns", async () => {
      const { service, records, database, stored } = await seeded();
      const later = [{ name: "later", type: "string" }] as const;
      const locked = records.withDatasetLock.bind(records);
      vi.spyOn(records, "withDatasetLock").mockImplementation(async (key, work) => {
        const result = await locked(key, work);
        const row = database.getDataset(dataset.projectId, dataset.id);
        database.putDataset({ ...row, columnTypes: [...later] });
        return result;
      });

      await service.upsertDataset({
        projectId: dataset.projectId,
        datasetId: dataset.id,
        name: "Renamed Set",
        columnTypes: [{ name: "reference", type: "string" }],
        columnRenames: [{ from: "expected_output", to: "reference" }],
      });

      expect(stored()).toEqual(later);
      expect(database.getDataset(dataset.projectId, dataset.id).name).toBe("Renamed Set");
    });
  });

  describe("when a column edit commits while a rename-only save is in flight", () => {
    /** @scenario "A dataset save does not undo a column edit that committed while it ran" */
    it("keeps the column edit's columns: the rename writes no columns", async () => {
      const { service, repository, database, stored } = await seeded();
      const later = [{ name: "later", type: "string" }] as const;
      const findBySlug = repository.findBySlug.bind(repository);
      vi.spyOn(repository, "findBySlug").mockImplementation(async (input) => {
        const found = await findBySlug(input);
        const row = database.getDataset(dataset.projectId, dataset.id);
        database.putDataset({ ...row, columnTypes: [...later] });
        return found;
      });

      await service.upsertDataset({
        projectId: dataset.projectId,
        datasetId: dataset.id,
        name: "Renamed Set",
        columnTypes: dataset.columnTypes,
      });

      expect(stored()).toEqual(later);
      expect(database.getDataset(dataset.projectId, dataset.id).name).toBe("Renamed Set");
    });
  });

  describe("when a save names only renames to the same name", () => {
    /** @scenario "A column edit that moves no values leaves the stored records untouched" */
    it("rewrites no record", async () => {
      const { service, records, entries } = await seeded();
      const replaceAll = vi.spyOn(records, "replaceAll");

      await service.upsertDataset({
        projectId: dataset.projectId,
        datasetId: dataset.id,
        name: dataset.name,
        columnTypes: [...dataset.columnTypes, { name: "notes", type: "string" }],
        columnRenames: [{ from: "input", to: "input" }],
      });

      expect(replaceAll).not.toHaveBeenCalled();
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
