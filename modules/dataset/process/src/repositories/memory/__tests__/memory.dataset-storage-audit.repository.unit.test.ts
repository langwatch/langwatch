/**
 * @vitest-environment node
 * The memory twin counts one project's leftovers by the rules the Postgres audit counts them by,
 * each kind apart (specs/datasets/storage-object-only/content-move-and-cleanup.feature).
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { DatasetStorageLeftovers } from "../../dataset-storage-audit.repository.ts";
import { MemoryDatasetContentRepository } from "../memory.dataset-content.repository.ts";
import { MemoryDatasetStorageAuditRepository } from "../memory.dataset-storage-audit.repository.ts";
import { MemoryDatasetDatabase } from "../memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../memory.dataset.repository.ts";

const MINE = "project-mine";
const THEIRS = "project-theirs";
const NOTHING: DatasetStorageLeftovers = {
  recordsTableDatasets: 0,
  recordsTableRows: 0,
  singleFileDatasets: 0,
  rowsAwaitingCleanup: 0,
  rowsUnderOtherProject: 0,
  orphanRows: 0,
};

let database: MemoryDatasetDatabase;
let audit: MemoryDatasetStorageAuditRepository;

beforeEach(() => {
  database = MemoryDatasetDatabase.create();
  audit = MemoryDatasetStorageAuditRepository.create({ database });
});

/** A dataset kept where the layout says, then `rows` records filed under `filedUnder`. */
async function dataset(input: {
  projectId?: string;
  contentLayout: string;
  useS3?: boolean;
  rows?: number;
  filedUnder?: string;
}): Promise<string> {
  const projectId = input.projectId ?? MINE;
  const created = await MemoryDatasetRepository.create({ database }).create({
    projectId,
    name: `dataset-${database.datasets().length}`,
    slug: `dataset-${database.datasets().length}`,
    columnTypes: [{ name: "input", type: "string" }],
    contentLayout: "postgres",
  });
  await MemoryDatasetContentRepository.create({ database }).update({
    id: created.id,
    projectId,
    data: { contentLayout: input.contentLayout, useS3: input.useS3 ?? false },
  });
  rows({ datasetId: created.id, projectId: input.filedUnder ?? projectId, count: input.rows ?? 0 });
  return created.id;
}

function rows(input: { datasetId: string; projectId: string; count: number }): void {
  for (let index = 0; index < input.count; index++) {
    database.putRecord({
      id: `${input.datasetId}-${input.projectId}-${index}`,
      datasetId: input.datasetId,
      projectId: input.projectId,
      entry: { input: `row ${index}` },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  }
}

describe("MemoryDatasetStorageAuditRepository.countLeftovers", () => {
  describe("given a dataset still in the records table", () => {
    it("counts the dataset and its rows as not yet moved", async () => {
      await dataset({ contentLayout: "postgres", rows: 3 });

      await expect(audit.countLeftovers({ projectId: MINE })).resolves.toEqual({
        ...NOTHING,
        recordsTableDatasets: 1,
        recordsTableRows: 3,
      });
    });
  });

  describe("given a dataset an older release kept as one file", () => {
    it("counts it as a single-file dataset, never as a records-table one", async () => {
      await dataset({ contentLayout: "postgres", useS3: true, rows: 2 });

      await expect(audit.countLeftovers({ projectId: MINE })).resolves.toEqual({
        ...NOTHING,
        singleFileDatasets: 1,
      });
    });
  });

  describe("given rows left in the table by a dataset already in object storage", () => {
    it("counts the rows as awaiting cleanup and not the dataset", async () => {
      await dataset({ contentLayout: "s3_jsonl", rows: 5 });

      await expect(audit.countLeftovers({ projectId: MINE })).resolves.toEqual({
        ...NOTHING,
        rowsAwaitingCleanup: 5,
      });
    });
  });

  describe("given rows filed under this project for another project's dataset", () => {
    it("counts them apart for this project and leaves them out of the other's", async () => {
      await dataset({ projectId: THEIRS, contentLayout: "postgres", rows: 2, filedUnder: MINE });

      await expect(audit.countLeftovers({ projectId: MINE })).resolves.toEqual({
        ...NOTHING,
        rowsUnderOtherProject: 2,
      });
      await expect(audit.countLeftovers({ projectId: THEIRS })).resolves.toEqual({
        ...NOTHING,
        recordsTableDatasets: 1,
      });
    });
  });

  describe("given rows whose dataset no longer exists", () => {
    it("counts them as orphan rows", async () => {
      rows({ datasetId: "gone", projectId: MINE, count: 4 });

      await expect(audit.countLeftovers({ projectId: MINE })).resolves.toEqual({
        ...NOTHING,
        orphanRows: 4,
      });
    });
  });

  describe("given another project's datasets and rows", () => {
    it("counts nothing of them for this project", async () => {
      await dataset({ projectId: THEIRS, contentLayout: "postgres", rows: 3 });
      await dataset({ projectId: THEIRS, contentLayout: "postgres", useS3: true });
      await dataset({ projectId: THEIRS, contentLayout: "s3_jsonl", rows: 2 });

      await expect(audit.countLeftovers({ projectId: MINE })).resolves.toEqual(NOTHING);
    });
  });
});
