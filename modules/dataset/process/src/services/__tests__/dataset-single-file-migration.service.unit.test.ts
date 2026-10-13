import { memoryObjectStorage } from "@langwatch/process-stores";
import { nowInstant, toDate } from "@langwatch/time";
import type { MigrationStepReport } from "@langwatch/upgrade/step";
import { describe, expect, it, vi } from "vitest";

import type { DatasetRow } from "../../repositories/dataset.repository.ts";
import { MemoryDatasetMigrationRepository } from "../../repositories/memory/memory.dataset-migration.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { ObjectStorageDatasetChunkRepository } from "../../repositories/object-storage/object-storage.dataset-chunk.repository.ts";
import { ObjectStorageDatasetSingleFileRepository } from "../../repositories/object-storage/object-storage.dataset-single-file.repository.ts";
import { singleFileKey } from "../../rules/dataset-single-file.rules.ts";
import { DatasetMigrationService } from "../dataset-migration.service.ts";

const PROJECTS = ["project_a", "project_b"];

/** The previous release's stored records: the whole row, with `entry` holding the columns. */
const OLD_FILE = JSON.stringify([
  { id: "rec_1", entry: { input: "hello" }, datasetId: "dataset_a", position: 1000 },
  { id: "rec_2", entry: { input: "world" }, datasetId: "dataset_a", position: 2000 },
]);

function datasetRow(input: { id: string; projectId: string; useS3?: boolean }): DatasetRow {
  const now = toDate(nowInstant());
  return {
    id: input.id,
    projectId: input.projectId,
    name: input.id,
    slug: input.id,
    columnTypes: [{ name: "input", type: "string" }],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    mapping: null,
    useS3: input.useS3 ?? true,
    s3RecordCount: 2,
    contentLayout: "postgres",
    status: "ready",
    statusError: null,
    stagingKey: null,
    uploadFilename: null,
    sourceStoredObjectId: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
  };
}

async function textOf(body: AsyncIterable<Uint8Array>): Promise<string> {
  return new Response(ReadableStream.from(body)).text();
}

function subject() {
  const database = MemoryDatasetDatabase.create();
  const objectStorage = memoryObjectStorage();
  const chunks = ObjectStorageDatasetChunkRepository.create({ objectStorage });
  const migration = DatasetMigrationService.create({
    repository: MemoryDatasetMigrationRepository.create({ database }),
    storage: chunks,
    projects: {
      listAllIds: async (page) => ({
        ids: PROJECTS.filter((id) => page?.after === undefined || id > page.after),
        next: null,
      }),
    },
    singleFiles: ObjectStorageDatasetSingleFileRepository.create({ objectStorage }),
  });
  const reports: MigrationStepReport[] = [];
  const runStep = (input: { dryRun?: boolean; resumeFrom?: MigrationStepReport | null } = {}) =>
    migration.runStep({
      checkpoint: {
        resumeFrom: input.resumeFrom ?? null,
        save: async ({ report }) => void reports.push(report),
      },
      dryRun: input.dryRun ?? false,
      signal: new AbortController().signal,
    });
  const writeFile = async (input: { projectId: string; datasetId: string; text: string }) => {
    const bytes = new TextEncoder().encode(input.text);
    async function* once() {
      yield bytes;
    }
    await objectStorage.write({ projectId: input.projectId, key: singleFileKey(input) }, once(), {
      byteLength: bytes.byteLength,
      contentType: "application/json",
    });
  };
  const readFile = async (input: { projectId: string; datasetId: string }) =>
    textOf(await objectStorage.read({ projectId: input.projectId, key: singleFileKey(input) }));
  const row = (input: { projectId: string; datasetId: string }) =>
    database.getDataset(input.projectId, input.datasetId);
  return { database, objectStorage, chunks, runStep, reports, writeFile, readFile, row };
}

const DATASET_A = { projectId: "project_a", datasetId: "dataset_a" };
const DATASET_B = { projectId: "project_b", datasetId: "dataset_b" };

describe("DatasetMigrationService single-file copy", () => {
  describe("given a dataset the previous release stored as one file in object storage", () => {
    /** @scenario "A single-file dataset is copied into chunks and keeps its file" */
    it("copies the records into chunks in file order, flips the layout and keeps the file", async () => {
      const { database, chunks, runStep, writeFile, readFile, row } = subject();
      database.putDataset(datasetRow({ id: "dataset_a", projectId: "project_a" }));
      await writeFile({ ...DATASET_A, text: OLD_FILE });

      await expect(runStep()).resolves.toMatchObject({ singleFileConverted: 1, failed: 0 });

      const copied = row(DATASET_A);
      expect(copied).toMatchObject({ contentLayout: "s3_jsonl", rowCount: 2, chunkCount: 1 });
      await expect(chunks.readChunks({ ...DATASET_A, chunkCount: 1 })).resolves.toEqual([
        { id: "rec_1", entry: { input: "hello" } },
        { id: "rec_2", entry: { input: "world" } },
      ]);
      await expect(readFile(DATASET_A)).resolves.toBe(OLD_FILE);
    });
  });

  describe("given the content move already copied a single-file dataset", () => {
    /** @scenario "A single-file dataset already copied is not copied again" */
    it("writes no chunk on the second run and reports nothing converted", async () => {
      const { database, objectStorage, runStep, writeFile } = subject();
      database.putDataset(datasetRow({ id: "dataset_a", projectId: "project_a" }));
      await writeFile({ ...DATASET_A, text: OLD_FILE });
      await runStep();
      const write = vi.spyOn(objectStorage, "write");

      await expect(runStep()).resolves.toMatchObject({ singleFileConverted: 0 });
      expect(write).not.toHaveBeenCalled();
    });
  });

  describe("given a single-file dataset whose file the previous release never wrote", () => {
    /** @scenario "A single-file dataset whose file is missing is skipped and reported" */
    it("completes the step, lists the dataset as missing and leaves its layout", async () => {
      const { database, runStep, row } = subject();
      database.putDataset(datasetRow({ id: "dataset_a", projectId: "project_a" }));

      await expect(runStep()).resolves.toMatchObject({
        singleFileConverted: 0,
        failed: 0,
        singleFileSkipped: [{ ...DATASET_A, reason: "missing" }],
      });
      expect(row(DATASET_A)).toMatchObject({ contentLayout: "postgres", useS3: true });
    });
  });

  describe("given a single-file dataset whose file is not a record array", () => {
    /** @scenario "A single-file dataset whose file is not a record array is skipped and reported" */
    it("completes the step and lists the dataset as unreadable", async () => {
      const { database, runStep, writeFile } = subject();
      database.putDataset(datasetRow({ id: "dataset_a", projectId: "project_a" }));
      await writeFile({ ...DATASET_A, text: "{not json" });

      await expect(runStep()).resolves.toMatchObject({
        failed: 0,
        singleFileSkipped: [{ ...DATASET_A, reason: "unreadable" }],
      });
    });
  });

  describe("given a dry run", () => {
    /** @scenario "A dry run of the single-file copy writes nothing" */
    it("counts the dataset it would copy and writes no chunk, checkpoint or layout", async () => {
      const { database, objectStorage, runStep, reports, writeFile, row } = subject();
      database.putDataset(datasetRow({ id: "dataset_a", projectId: "project_a" }));
      await writeFile({ ...DATASET_A, text: OLD_FILE });
      const write = vi.spyOn(objectStorage, "write");

      await expect(runStep({ dryRun: true })).resolves.toMatchObject({
        singleFileWouldConvert: 1,
        singleFileConverted: 0,
        dryRun: true,
      });
      expect(write).not.toHaveBeenCalled();
      expect(reports).toEqual([]);
      expect(row(DATASET_A)).toMatchObject({ contentLayout: "postgres" });
    });
  });

  describe("given a checkpoint saved after project_a that lists a skipped dataset", () => {
    /** @scenario "A resumed single-file copy continues after its checkpoint and keeps the skipped list" */
    it("copies only project_b's datasets and still reports the earlier skip", async () => {
      const { database, runStep, writeFile, row } = subject();
      database.putDataset(datasetRow({ id: "dataset_a", projectId: "project_a" }));
      database.putDataset(datasetRow({ id: "dataset_b", projectId: "project_b" }));
      await writeFile({ ...DATASET_A, text: OLD_FILE });
      await writeFile({ ...DATASET_B, text: OLD_FILE });
      const skipped = { projectId: "project_a", datasetId: "dataset_gone", reason: "missing" };

      await expect(
        runStep({ resumeFrom: { afterProjectId: "project_a", singleFileSkipped: [skipped] } }),
      ).resolves.toMatchObject({ singleFileConverted: 1, singleFileSkipped: [skipped] });
      expect(row(DATASET_A)).toMatchObject({ contentLayout: "postgres" });
      expect(row(DATASET_B)).toMatchObject({ contentLayout: "s3_jsonl" });
    });
  });
});
