/**
 * @vitest-environment node
 * The records table refuses rows for a dataset whose rows live in object storage, over the
 * memory twins. The Postgres repository answers the same in the repository contract suite.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { DatasetRecordRepository } from "../dataset-record.repository.ts";
import { MemoryDatasetContentRepository } from "../memory/memory.dataset-content.repository.ts";
import { MemoryDatasetRecordRepository } from "../memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../memory/memory.dataset.repository.ts";

const PROJECT = "project-1";

let database: MemoryDatasetDatabase;
let records: DatasetRecordRepository;

beforeEach(() => {
  database = MemoryDatasetDatabase.create();
  records = MemoryDatasetRecordRepository.create({ database });
});

/** A dataset row, then moved to wherever `layout` says its rows live. */
async function datasetIn(layout: { contentLayout: string; useS3?: boolean }): Promise<string> {
  const created = await MemoryDatasetRepository.create({ database }).create({
    projectId: PROJECT,
    name: "support-tickets",
    slug: "support-tickets",
    columnTypes: [{ name: "input", type: "string" }],
    contentLayout: "postgres",
  });
  await MemoryDatasetContentRepository.create({ database }).update({
    id: created.id,
    projectId: PROJECT,
    data: { contentLayout: layout.contentLayout, useS3: layout.useS3 ?? false },
  });
  return created.id;
}

const rowsOf = (datasetId: string) =>
  database.records().filter((record) => record.datasetId === datasetId);

describe("given a dataset whose rows are kept in object storage", () => {
  /** @scenario "A records-table write for a dataset kept in object storage is refused" */
  it("refuses to add rows, naming the dataset, and adds none", async () => {
    const datasetId = await datasetIn({ contentLayout: "s3_jsonl" });

    await expect(
      records.createMany({
        datasetId,
        projectId: PROJECT,
        entries: [{ id: "r1", input: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: "dataset_records_table_write_refused",
      meta: { datasetId },
    });
    expect(rowsOf(datasetId)).toEqual([]);
  });

  /** @scenario "A records-table write for a dataset kept in object storage is refused" */
  it("refuses to replace its rows and adds none", async () => {
    const datasetId = await datasetIn({ contentLayout: "s3_jsonl" });

    await expect(
      records.replaceAll({ datasetId, projectId: PROJECT, entries: [{ id: "r1", input: "a" }] }),
    ).rejects.toMatchObject({ code: "dataset_records_table_write_refused" });
    expect(rowsOf(datasetId)).toEqual([]);
  });

  /** @scenario "A records-table write for a dataset kept in object storage is refused" */
  it("refuses to change a row of it", async () => {
    const datasetId = await datasetIn({ contentLayout: "s3_jsonl" });

    await expect(
      records.update({ id: "r1", datasetId, projectId: PROJECT, entry: { input: "b" } }),
    ).rejects.toMatchObject({ code: "dataset_records_table_write_refused" });
  });

  /** @scenario "A records-table write for a dataset kept in object storage is refused" */
  it("refuses to delete rows of it", async () => {
    const datasetId = await datasetIn({ contentLayout: "s3_jsonl" });

    await expect(
      records.deleteMany({ datasetId, projectId: PROJECT, recordIds: ["r1"] }),
    ).rejects.toMatchObject({ code: "dataset_records_table_write_refused" });
  });

  /** @scenario "A records-table write for a dataset kept in object storage is refused" */
  it("refuses a write made under the dataset's lock", async () => {
    const datasetId = await datasetIn({ contentLayout: "s3_jsonl" });

    await expect(
      records.withDatasetLock({ datasetId, projectId: PROJECT }, (locked) =>
        locked.createMany({ datasetId, projectId: PROJECT, entries: [{ id: "r1", input: "a" }] }),
      ),
    ).rejects.toMatchObject({ code: "dataset_records_table_write_refused" });
    expect(rowsOf(datasetId)).toEqual([]);
  });

  /** @scenario "A records-table write for a dataset kept in object storage is refused" */
  it("refuses a single-file dataset too", async () => {
    const datasetId = await datasetIn({ contentLayout: "postgres", useS3: true });

    await expect(
      records.createMany({ datasetId, projectId: PROJECT, entries: [{ id: "r1", input: "a" }] }),
    ).rejects.toMatchObject({ code: "dataset_records_table_write_refused" });
    expect(rowsOf(datasetId)).toEqual([]);
  });
});

describe("given a dataset whose rows are still in the records table", () => {
  it("adds the rows", async () => {
    const datasetId = await datasetIn({ contentLayout: "postgres" });

    await records.createMany({
      datasetId,
      projectId: PROJECT,
      entries: [{ id: "r1", input: "hello" }],
    });

    expect(rowsOf(datasetId).map((record) => record.id)).toEqual(["r1"]);
  });
});

describe("given no dataset row in the project", () => {
  const datasetId = "missing-dataset";

  /** @scenario "A records-table write for a dataset that does not exist is refused" */
  it("refuses to add, replace or change rows, and adds none", async () => {
    const entries = [{ id: "r1", input: "a" }];
    const key = { datasetId, projectId: PROJECT };

    await expect(records.createMany({ ...key, entries })).rejects.toMatchObject({
      code: "dataset_not_found",
    });
    await expect(records.replaceAll({ ...key, entries })).rejects.toMatchObject({
      code: "dataset_not_found",
    });
    await expect(records.update({ ...key, id: "r1", entry: { input: "b" } })).rejects.toMatchObject(
      { code: "dataset_not_found" },
    );
    expect(rowsOf(datasetId)).toEqual([]);
  });

  /** @scenario "A records-table write for a dataset that does not exist is refused" */
  it("still removes rows left behind for it", async () => {
    const owner = await datasetIn({ contentLayout: "postgres" });
    await records.createMany({ datasetId: owner, projectId: PROJECT, entries: [{ id: "r1" }] });
    database.removeDataset(PROJECT, owner);

    await records.deleteMany({ datasetId: owner, projectId: PROJECT, recordIds: ["r1"] });

    expect(rowsOf(owner)).toEqual([]);
  });
});
