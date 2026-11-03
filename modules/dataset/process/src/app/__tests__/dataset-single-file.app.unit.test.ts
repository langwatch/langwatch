import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { FilesystemDatasetSingleFileRepository } from "../../repositories/filesystem/filesystem.dataset-single-file.repository.ts";
import { MemoryDatasetContentRepository } from "../../repositories/memory/memory.dataset-content.repository.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { createDatasetTestApp, createDatasetTestEntitlementWith } from "./dataset.fixture.ts";

const projectId = "project_single";

/** The array the previous release wrote: `{ id, entry, ... }` per record, in order. */
const previousReleaseFile = [
  {
    id: "rec_1",
    entry: { question: "What is LangWatch?" },
    datasetId: "",
    projectId,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    position: 1000,
  },
  { id: "rec_2", entry: { question: "How are traces stored?" }, datasetId: "", projectId },
  { id: "rec_3", entry: { question: "Where do datasets live?" }, datasetId: "", projectId },
];

type Storage = { name: string; repositories: () => Promise<DatasetRepositories> };

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dataset-single-file-app-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const storages: Storage[] = [
  { name: "object storage", repositories: async () => MemoryDatasetRepositories.create() },
  {
    name: "local disk",
    repositories: async () => ({
      ...MemoryDatasetRepositories.create(),
      singleFiles: FilesystemDatasetSingleFileRepository.create({ localPath: root }),
    }),
  },
];

async function setup(storage: Storage, file: unknown[] | "none" = previousReleaseFile) {
  const repositories = await storage.repositories();
  const dataset = await repositories.content.create({
    projectId,
    name: "Legacy Questions",
    slug: "legacy-questions",
    columnTypes: [{ name: "question", type: "string" }],
    useS3: true,
    s3RecordCount: file === "none" ? 0 : file.length,
  });
  if (file !== "none") {
    await repositories.singleFiles.putSingleFile({
      projectId,
      datasetId: dataset.id,
      text: JSON.stringify(file),
    });
  }
  const app = createDatasetTestApp({ repositories });
  const stored = async () => {
    const found = await repositories.singleFiles.getSingleFile({
      projectId,
      datasetId: dataset.id,
    });
    if (found.outcome !== "found") throw new Error("no single file");
    return JSON.parse(found.text);
  };
  return { app, repositories, datasetId: dataset.id, stored };
}

describe.each(storages)("a single-file dataset in $name", (storage) => {
  describe("when its records are read", () => {
    /** @scenario "Single-file dataset records are read from the file the previous release wrote" */
    it("lists, pages, previews and reads them whole in stored order", async () => {
      const { app, datasetId } = await setup(storage);

      const page = await app.getDatasetPage({ slugOrId: datasetId, projectId, page: 1, limit: 2 });
      expect(page.datasetRecords.map((record) => record.id)).toEqual(["rec_1", "rec_2"]);
      expect(page).toMatchObject({ count: 3, totalPages: 2 });

      const listed = await app.listRecords({ slugOrId: datasetId, projectId, page: 2, limit: 2 });
      expect(listed.data.map((record) => record.entry)).toEqual([
        { question: "Where do datasets live?" },
      ]);

      const head = await app.getDatasetHead({ slugOrId: datasetId, projectId });
      expect(head.total).toBe(3);
      expect(head.records).toHaveLength(3);

      const whole = await app.getDatasetWithRecords({ slugOrId: datasetId, projectId });
      expect(whole.records.map((record) => record.id)).toEqual(["rec_1", "rec_2", "rec_3"]);
      expect(whole.truncated).toBe(false);
      expect(whole.records[0]?.createdAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
      expect(whole.records[1]?.createdAt).toEqual(whole.dataset.createdAt);

      const last = await app.getDatasetWithRecords({
        slugOrId: datasetId,
        projectId,
        entrySelection: "last",
      });
      expect(last.records.map((record) => record.id)).toEqual(["rec_3"]);
    });

    /** @scenario "Single-file dataset records are searched in the file" */
    it("pages only the records whose cells hold the search text", async () => {
      const { app, datasetId } = await setup(storage);

      const page = await app.getDatasetPage({
        slugOrId: datasetId,
        projectId,
        page: 1,
        limit: 10,
        search: "datasets",
      });

      expect(page.datasetRecords.map((record) => record.id)).toEqual(["rec_3"]);
      expect(page.count).toBe(1);
    });

    /** @scenario "Searching a single-file dataset larger than one search may read is refused" */
    it("refuses a search when the file is larger than the whole-read limit", async () => {
      const { repositories, datasetId } = await setup(storage);
      const app = createDatasetTestApp({
        repositories,
        dependencies: { entitlement: createDatasetTestEntitlementWith({ wholeReadBytes: 64 }) },
      });

      await expect(
        app.getDatasetPage({ slugOrId: datasetId, projectId, page: 1, limit: 10, search: "x" }),
      ).rejects.toMatchObject({ code: "dataset_too_large_to_search" });
    });

    /** @scenario "A single-file record stored without an id keeps one id" */
    it("gives a record stored without an id one id, kept in the file", async () => {
      const { app, datasetId, stored } = await setup(storage, [
        { entry: { question: "Stored without an id" } },
        ...previousReleaseFile,
      ]);

      const first = await app.getDatasetHead({ slugOrId: datasetId, projectId });
      const second = await app.getDatasetHead({ slugOrId: datasetId, projectId });
      const shown = first.records[0]?.id;
      expect(shown).toEqual(expect.any(String));
      expect(second.records[0]?.id).toBe(shown);
      expect((await stored())[0]).toMatchObject({ id: shown });

      await app.deleteRecords({ slugOrId: datasetId, projectId, recordIds: [shown ?? ""] });
      expect((await stored()).map((record: { id: string }) => record.id)).toEqual([
        "rec_1",
        "rec_2",
        "rec_3",
      ]);
    });
  });

  describe("when the file is missing", () => {
    /** @scenario "A single-file dataset whose file is missing reads as empty" */
    it("reads as an empty dataset, and a first record creates the file", async () => {
      const { app, datasetId, stored } = await setup(storage, "none");

      const head = await app.getDatasetHead({ slugOrId: datasetId, projectId });
      expect(head).toMatchObject({ records: [], total: 0 });

      await app.batchCreateRecords({
        slugOrId: datasetId,
        projectId,
        entries: [{ id: "rec_new", question: "First?" }],
      });
      expect((await stored()).map((record: { id: string }) => record.id)).toEqual(["rec_new"]);
    });
  });

  describe("when the file is not a record array", () => {
    /** @scenario "A single-file dataset whose file is unreadable refuses rather than overwriting it" */
    it("refuses reads and writes, leaving the file as it is", async () => {
      const { app, repositories, datasetId } = await setup(storage, "none");
      await repositories.singleFiles.putSingleFile({ projectId, datasetId, text: "not json" });

      await expect(app.getDatasetHead({ slugOrId: datasetId, projectId })).rejects.toThrow(Error);
      await expect(
        app.batchCreateRecords({ slugOrId: datasetId, projectId, entries: [{ question: "x" }] }),
      ).rejects.toThrow(Error);
      await expect(
        repositories.singleFiles.getSingleFile({ projectId, datasetId }),
      ).resolves.toEqual({ outcome: "found", text: "not json" });
    });
  });

  describe("when records are added, updated and deleted", () => {
    /** @scenario "Single-file dataset records are added, updated and deleted in the file" */
    it("rewrites the file in the previous release's shape and keeps its count", async () => {
      const { app, repositories, datasetId, stored } = await setup(storage);

      const added = await app.batchCreateRecords({
        slugOrId: datasetId,
        projectId,
        entries: [{ id: "rec_4", question: "Is it\u0000 clean?" }, { question: "No id given" }],
      });
      expect(added).toHaveLength(2);
      expect(added[0]?.entry).toEqual({ question: "Is it clean?" });

      const updated = await app.upsertRecord({
        slugOrId: datasetId,
        projectId,
        recordId: "rec_1",
        updatedRecord: { question: "What is LangWatch, really?" },
      });
      expect(updated.created).toBe(false);
      const created = await app.upsertRecord({
        slugOrId: datasetId,
        projectId,
        recordId: "rec_5",
        updatedRecord: { question: "Created by an edit" },
      });
      expect(created.created).toBe(true);

      const deleted = await app.deleteRecords({
        slugOrId: datasetId,
        projectId,
        recordIds: ["rec_2", "rec_missing"],
      });
      expect(deleted).toEqual({ count: 1 });

      const file = await stored();
      expect(file.map((record: { id: string }) => record.id)).toEqual([
        "rec_1",
        "rec_3",
        "rec_4",
        added[1]?.id,
        "rec_5",
      ]);
      expect(file[0]).toMatchObject({
        entry: { question: "What is LangWatch, really?" },
        createdAt: "2025-01-01T00:00:00.000Z",
        position: 1000,
      });
      expect(file[2]).toMatchObject({ datasetId, projectId, position: 1000 });
      expect(file[3]).toMatchObject({ position: 2000 });

      const row = await repositories.content.getOne({ id: datasetId, projectId });
      expect(row.s3RecordCount).toBe(5);
      expect(row.contentLayout).toBe("postgres");
      expect(await repositories.records.count({ datasetId, projectId })).toBe(0);
    });

    /** @scenario "A failed count update leaves the single file as it was" */
    it("leaves the file as it was when recording the count fails", async () => {
      const { app, repositories, datasetId, stored } = await setup(storage);
      vi.spyOn(MemoryDatasetContentRepository.prototype, "update").mockRejectedValueOnce(
        new Error("count update failed"),
      );

      await expect(
        app.batchCreateRecords({ slugOrId: datasetId, projectId, entries: [{ question: "x" }] }),
      ).rejects.toThrow("count update failed");
      expect(await stored()).toEqual(previousReleaseFile);
      const row = await repositories.content.getOne({ id: datasetId, projectId });
      expect(row.s3RecordCount).toBe(3);
    });

    /** @scenario "Deleting ids a single-file dataset does not hold is refused" */
    it("refuses a delete that matched nothing", async () => {
      const { app, datasetId } = await setup(storage);

      await expect(
        app.deleteMatchingRecords({ slugOrId: datasetId, projectId, recordIds: ["rec_missing"] }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("when a file is uploaded to it", () => {
    /** @scenario "A file uploaded to a single-file dataset is appended to its file" */
    it("appends the file's rows to the single file", async () => {
      const { app, datasetId, stored } = await setup(storage);
      const csv = "question\nUploaded one\nUploaded two\n";

      const result = await app.uploadToExistingDataset({
        slugOrId: datasetId,
        projectId,
        filename: "more.csv",
        bytes: bytesOf(csv),
        fileSize: Buffer.byteLength(csv, "utf8"),
      });

      expect(result.recordsCreated).toBe(2);
      const file = await stored();
      expect(file.map((record: { entry: unknown }) => record.entry)).toEqual([
        ...previousReleaseFile.map((record) => record.entry),
        { question: "Uploaded one" },
        { question: "Uploaded two" },
      ]);
    });
  });

  describe("when it is copied", () => {
    /** @scenario "A single-file dataset copies its records into the new dataset" */
    it("copies every entry from the file", async () => {
      const { app, datasetId } = await setup(storage);

      const copy = await app.copyDataset({
        sourceDatasetId: datasetId,
        sourceProjectId: projectId,
        targetProjectId: projectId,
      });

      const page = await app.getDatasetPage({ slugOrId: copy.id, projectId, page: 1, limit: 10 });
      // The scenario promises the same entries, not their order (the read sorts by copied ids).
      const entries = page.datasetRecords.map((record) => record.entry);
      expect(entries).toHaveLength(previousReleaseFile.length);
      expect(entries).toEqual(
        expect.arrayContaining(previousReleaseFile.map((record) => record.entry)),
      );
    });
  });
});

describe("a dataset in today's layout", () => {
  /** @scenario "Datasets in today's layouts never read a single file" */
  it("reads its own records even when a file sits at the old key", async () => {
    const repositories = MemoryDatasetRepositories.create();
    const app = createDatasetTestApp({ repositories });
    const dataset = await app.upsertDataset({
      projectId,
      name: "Current Questions",
      columnTypes: [{ name: "question", type: "string" }],
      datasetRecords: [{ question: "From the record table" }],
    });
    await repositories.singleFiles.putSingleFile({
      projectId,
      datasetId: dataset.id,
      text: JSON.stringify(previousReleaseFile),
    });

    const page = await app.getDatasetPage({ slugOrId: dataset.id, projectId, page: 1, limit: 10 });
    expect(page.datasetRecords.map((record) => record.entry)).toEqual([
      { question: "From the record table" },
    ]);
  });
});

async function* bytesOf(content: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(content);
}
