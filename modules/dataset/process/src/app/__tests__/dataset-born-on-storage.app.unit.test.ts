/**
 * @vitest-environment node
 * A dataset made by create or copy keeps its rows in object storage, never in
 * the Postgres records table (ADR-032 v13, born on storage).
 * @see specs/datasets/large-dataset-storage.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { createDatasetTestApp } from "./dataset.fixture.ts";

const projectId = "project-born";
const columnTypes = [{ name: "question", type: "string" as const }];

/** The memory repositories, with chunk writes that fail once they are asked for. */
function failingChunkWrites(): { repositories: DatasetRepositories; reaped: string[] } {
  const repositories = MemoryDatasetRepositories.create();
  const reaped: string[] = [];
  const stored = repositories.chunks;
  const chunks: DatasetChunkRepository = {
    readChunk: (input) => stored.readChunk(input),
    readChunks: (input) => stored.readChunks(input),
    rewriteChunk: (input) => stored.rewriteChunk(input),
    readStagedUpload: (input) => stored.readStagedUpload(input),
    removeStagedUpload: (input) => stored.removeStagedUpload(input),
    writeChunks: () => Promise.reject(new Error("object storage is unavailable")),
    deleteChunksFrom: async (input) => {
      reaped.push(input.datasetId);
    },
  };

  return { repositories: { ...repositories, chunks }, reaped };
}

/** The memory repositories, real chunk writes kept, with every reap recorded. */
function recordingReaps(): { repositories: DatasetRepositories; reaped: string[] } {
  const repositories = MemoryDatasetRepositories.create();
  const reaped: string[] = [];
  const deleteChunksFrom = repositories.chunks.deleteChunksFrom.bind(repositories.chunks);
  vi.spyOn(repositories.chunks, "deleteChunksFrom").mockImplementation(async (input) => {
    reaped.push(input.datasetId);
    await deleteChunksFrom(input);
  });

  return { repositories, reaped };
}

async function storedRecordCount(
  repositories: DatasetRepositories,
  datasetId: string,
  inProject = projectId,
): Promise<number> {
  return repositories.records.count({ datasetId, projectId: inProject });
}

describe("creating a dataset", () => {
  describe("given rows that come with the create", () => {
    /** @scenario "A new dataset is created directly in object storage" */
    it("stores the rows as chunks in object storage and none in the records table", async () => {
      const repositories = MemoryDatasetRepositories.create();
      const app = createDatasetTestApp({ repositories });

      const created = await app.upsertDataset({
        projectId,
        name: "Born Questions",
        columnTypes,
        datasetRecords: [{ id: "rec_pinned", question: "What is 2+2?" }, { question: "Why?" }],
      });

      expect(created).toMatchObject({
        contentLayout: "s3_jsonl",
        status: "ready",
        rowCount: 2,
        chunkCount: 1,
      });
      const chunk = await repositories.chunks.readChunk({
        projectId,
        datasetId: created.id,
        index: 0,
      });
      expect(chunk).toHaveLength(2);
      expect(await storedRecordCount(repositories, created.id)).toBe(0);
      const page = await app.getDatasetPage({
        projectId,
        slugOrId: created.id,
        page: 1,
        limit: 10,
      });
      expect(page.datasetRecords.map((record) => record.entry)).toEqual([
        { question: "What is 2+2?" },
        { question: "Why?" },
      ]);
      expect(page.datasetRecords[0]?.id).toBe("rec_pinned");
    });
  });

  describe("given no rows", () => {
    /** @scenario "A new dataset is created directly in object storage" */
    it("is born in object storage, so the rows added later land there too", async () => {
      const repositories = MemoryDatasetRepositories.create();
      const app = createDatasetTestApp({ repositories });

      const created = await app.upsertDataset({ projectId, name: "Empty Born", columnTypes });
      await app.batchCreateRecords({
        projectId,
        slugOrId: created.id,
        entries: [{ question: "added later" }],
      });

      expect(created).toMatchObject({
        contentLayout: "s3_jsonl",
        status: "ready",
        rowCount: 0,
        chunkCount: 0,
      });
      expect(await storedRecordCount(repositories, created.id)).toBe(0);
      const page = await app.getDatasetPage({
        projectId,
        slugOrId: created.id,
        page: 1,
        limit: 10,
      });
      expect(page.datasetRecords.map((record) => record.entry)).toEqual([
        { question: "added later" },
      ]);
    });
  });

  describe("when the chunk write fails", () => {
    /** @scenario "A failed create leaves no dataset behind" */
    it("leaves no dataset row and reaps what it wrote", async () => {
      const { repositories, reaped } = failingChunkWrites();
      const app = createDatasetTestApp({ repositories });

      await expect(
        app.upsertDataset({
          projectId,
          name: "Never Born",
          columnTypes,
          datasetRecords: [{ question: "lost" }],
        }),
      ).rejects.toThrow("object storage is unavailable");

      expect(await repositories.datasets.findBySlug({ projectId, slug: "never-born" })).toBeNull();
      expect(reaped).toHaveLength(1);
    });
  });

  describe("when the dataset row insert fails after the chunks were written", () => {
    /** @scenario "A failed create leaves no dataset behind" */
    it("leaves no dataset row and reaps the written chunks", async () => {
      const { repositories, reaped } = recordingReaps();
      vi.spyOn(repositories.content, "create").mockRejectedValue(
        new Error("the database is unavailable"),
      );
      const app = createDatasetTestApp({ repositories });

      await expect(
        app.upsertDataset({
          projectId,
          name: "Row Lost",
          columnTypes,
          datasetRecords: [{ question: "written, then orphaned" }],
        }),
      ).rejects.toThrow("the database is unavailable");

      expect(await repositories.datasets.findBySlug({ projectId, slug: "row-lost" })).toBeNull();
      expect(reaped).toHaveLength(1);
    });
  });

  describe("given two rows with the same id", () => {
    /** @scenario "A new dataset refuses two rows with the same id" */
    it("refuses the create, leaves no dataset row and reaps what it wrote", async () => {
      const { repositories, reaped } = recordingReaps();
      const app = createDatasetTestApp({ repositories });

      const failure = await app
        .upsertDataset({
          projectId,
          name: "Twin Ids",
          columnTypes,
          datasetRecords: [
            { id: "rec_twin", question: "first" },
            { id: "rec_twin", question: "second" },
          ],
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(failure).toMatchObject({ code: "dataset_duplicate_record_id" });
      expect(await repositories.datasets.findBySlug({ projectId, slug: "twin-ids" })).toBeNull();
      expect(reaped).toHaveLength(1);
    });
  });
});

describe("adding rows to a dataset in object storage", () => {
  describe("given rows that come without an id", () => {
    /** @scenario "Rows added to a dataset in object storage come back with the ids they were stored under" */
    it("answers each row with the id it was stored under", async () => {
      const repositories = MemoryDatasetRepositories.create();
      const app = createDatasetTestApp({ repositories });
      const dataset = await app.upsertDataset({ projectId, name: "Added Rows", columnTypes });

      const added = await app.batchCreateRecords({
        projectId,
        slugOrId: dataset.id,
        entries: [{ question: "first" }, { question: "second" }],
      });

      const stored = await repositories.chunks.readChunk({
        projectId,
        datasetId: dataset.id,
        index: 0,
      });
      expect(added.map((record) => record.id)).toEqual(
        stored.map((line) => (line as { id: string }).id),
      );
    });
  });
});

describe("copying a dataset kept in the Postgres records table", () => {
  /** @scenario "A copy of a dataset is created directly in object storage" */
  it("writes the copy's rows to object storage and none to the records table", async () => {
    const repositories = MemoryDatasetRepositories.create();
    const source = await repositories.content.create({
      projectId,
      name: "Legacy Rows",
      slug: "legacy-rows",
      columnTypes,
    });
    await repositories.records.createMany({
      datasetId: source.id,
      projectId,
      entries: [
        { id: "rec_1", question: "first" },
        { id: "rec_2", question: "second" },
      ],
    });
    const app = createDatasetTestApp({ repositories });

    const copy = await app.copyDataset({
      sourceDatasetId: source.id,
      sourceProjectId: projectId,
      targetProjectId: "project-target",
    });

    expect(copy).toMatchObject({ contentLayout: "s3_jsonl", status: "ready", rowCount: 2 });
    expect(await storedRecordCount(repositories, copy.id, "project-target")).toBe(0);
    const page = await app.getDatasetPage({
      projectId: "project-target",
      slugOrId: copy.id,
      page: 1,
      limit: 10,
    });
    expect(page.datasetRecords.map((record) => record.entry)).toEqual([
      { question: "first" },
      { question: "second" },
    ]);
  });
});
