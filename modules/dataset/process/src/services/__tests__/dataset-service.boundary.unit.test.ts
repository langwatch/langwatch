import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @vitest-environment node
 * The shared Dataset service at its own boundary, over the memory repositories:
 * what it validates, what it scopes to a project and what it hands each repository.
 * @see modules/dataset/specs/dataset-service.feature
 */
import { datasetRecordSchema, datasetSchema, type Dataset } from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

const SOURCE_PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const columnTypes = [{ name: "question", type: "string" as const }];

/** One service over memory repositories, with every repository call it makes recorded. */
function serviceOverMemory() {
  const database = MemoryDatasetDatabase.create();
  const repository = MemoryDatasetRepository.create({ database });
  const records = MemoryDatasetRecordRepository.create({ database });
  const spies = {
    create: vi.spyOn(repository, "create"),
    createMany: vi.spyOn(records, "createMany"),
    listAll: vi.spyOn(records, "listAll"),
    update: vi.spyOn(records, "update"),
    deleteMany: vi.spyOn(records, "deleteMany"),
  };
  let minted = 0;
  const service = DatasetService.create({
    repository,
    records,
    generateId: () => `record_${(minted += 1)}`,
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
  });

  return { database, service, spies };
}

/** Marks a stored dataset as still being prepared, the way an import in flight leaves it. */
function markProcessing(database: MemoryDatasetDatabase, dataset: Dataset) {
  database.putDataset({
    ...database.getDataset(dataset.projectId, dataset.id),
    status: "processing",
  });
}

describe("DatasetService boundary", () => {
  describe("when a caller creates a dataset with columns and records", () => {
    /** @scenario "A dataset is created with a portable contract" */
    it("validates the input, answers a portable Dataset and writes the records through the record repository", async () => {
      const { service, spies } = serviceOverMemory();

      const created = await service.upsertDataset({
        projectId: SOURCE_PROJECT,
        name: "Golden Set",
        columnTypes,
        datasetRecords: [{ question: "one" }, { question: "two" }],
      });

      expect(datasetSchema.parse(created)).toEqual(created);
      expect(created).toMatchObject({ projectId: SOURCE_PROJECT, slug: "golden-set" });
      expect(spies.createMany).toHaveBeenCalledOnce();
      expect(spies.createMany.mock.calls[0]![0]).toMatchObject({
        datasetId: created.id,
        projectId: SOURCE_PROJECT,
        entries: [{ question: "one" }, { question: "two" }],
      });
    });

    /** @scenario "A dataset is created with a portable contract" */
    it("refuses input the Dataset contract does not accept before any repository is touched", async () => {
      const { service, spies } = serviceOverMemory();

      const refusal = await service
        .upsertDataset({ projectId: SOURCE_PROJECT, name: "", columnTypes })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ZodError);
      expect(spies.create).not.toHaveBeenCalled();
      expect(spies.createMany).not.toHaveBeenCalled();
    });
  });

  describe("when a caller validates a name another dataset's slug already holds", () => {
    /** @scenario "Dataset names remain unique within a project" */
    it("reports the name unavailable and names the dataset that holds it", async () => {
      const { service } = serviceOverMemory();
      await service.upsertDataset({ projectId: SOURCE_PROJECT, name: "golden-set", columnTypes });

      await expect(
        service.validateDatasetName({ projectId: SOURCE_PROJECT, proposedName: "Golden Set" }),
      ).resolves.toEqual({ available: false, slug: "golden-set", conflictsWith: "golden-set" });
      await expect(
        service.validateDatasetName({ projectId: OTHER_PROJECT, proposedName: "Golden Set" }),
      ).resolves.toEqual({ available: true, slug: "golden-set" });
    });
  });

  describe("when a caller looks up a dataset using another project id", () => {
    /** @scenario "A dataset lookup is tenant-scoped" */
    it("throws DatasetNotFoundError and returns nothing of the other project's dataset", async () => {
      const { service } = serviceOverMemory();
      const created = await service.upsertDataset({
        projectId: SOURCE_PROJECT,
        name: "Golden Set",
        columnTypes,
      });

      for (const slugOrId of [created.id, created.slug]) {
        const outcome = await service.getBySlugOrId({ projectId: OTHER_PROJECT, slugOrId }).then(
          (found) => ({ found }),
          (error: unknown) => ({ error }),
        );

        expect(outcome).toMatchObject({ error: { code: "dataset_not_found" } });
      }
      await expect(
        service.getBySlugOrId({ projectId: SOURCE_PROJECT, slugOrId: created.id }),
      ).resolves.toMatchObject({ id: created.id });
    });
  });

  describe("when a caller creates, updates, lists or deletes records", () => {
    /** @scenario "Records use the Dataset boundary" */
    it("delegates each to the record repository and answers contract records only", async () => {
      const { service, spies } = serviceOverMemory();
      const dataset = await service.upsertDataset({
        projectId: SOURCE_PROJECT,
        name: "Golden Set",
        columnTypes,
      });
      const lookup = { slugOrId: dataset.id, projectId: SOURCE_PROJECT };

      const [created] = await service.createRecords({ ...lookup, entries: [{ question: "one" }] });
      const updated = await service.updateRecord({
        ...lookup,
        recordId: created!.id,
        updatedRecord: { question: "two" },
      });
      const page = await service.listRecords(lookup);
      const deleted = await service.deleteRecords({ ...lookup, recordIds: [created!.id] });

      expect(spies.createMany).toHaveBeenCalledOnce();
      expect(spies.update).toHaveBeenCalledOnce();
      expect(spies.listAll).toHaveBeenCalled();
      expect(spies.deleteMany).toHaveBeenCalledOnce();
      expect(updated.entry).toMatchObject({ question: "two" });
      expect(page.data.map((record) => datasetRecordSchema.parse(record))).toEqual(page.data);
      expect(deleted).toEqual({ count: 1 });
    });

    /** @scenario "Records use the Dataset boundary" */
    it("checks the dataset is ready first and touches no record when it is not", async () => {
      const { database, service, spies } = serviceOverMemory();
      const dataset = await service.upsertDataset({
        projectId: SOURCE_PROJECT,
        name: "Golden Set",
        columnTypes,
      });
      markProcessing(database, dataset);
      const lookup = { slugOrId: dataset.id, projectId: SOURCE_PROJECT };

      const refusals = await Promise.all([
        service.createRecords({ ...lookup, entries: [{ question: "one" }] }).catch(refusal),
        service
          .updateRecord({ ...lookup, recordId: "record_1", updatedRecord: { question: "two" } })
          .catch(refusal),
        service.listRecords(lookup).catch(refusal),
        service.deleteRecords({ ...lookup, recordIds: ["record_1"] }).catch(refusal),
      ]);

      for (const outcome of refusals) {
        expect(outcome).toMatchObject({ code: "dataset_not_ready" });
      }
      expect(spies.createMany).not.toHaveBeenCalled();
      expect(spies.update).not.toHaveBeenCalled();
      expect(spies.listAll).not.toHaveBeenCalled();
      expect(spies.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when a caller copies a dataset to another project", () => {
    /** @scenario "Dataset copy remains a Dataset operation" */
    it("creates the target through the dataset repository and copies the records through the record repository", async () => {
      const { database, service, spies } = serviceOverMemory();
      const source = await service.upsertDataset({
        projectId: SOURCE_PROJECT,
        name: "Golden Set",
        columnTypes,
        datasetRecords: [{ question: "one" }, { question: "two" }],
      });
      spies.create.mockClear();
      spies.createMany.mockClear();

      const target = await service.copyDataset({
        sourceDatasetId: source.id,
        sourceProjectId: SOURCE_PROJECT,
        targetProjectId: OTHER_PROJECT,
      });

      expect(spies.create).toHaveBeenCalledOnce();
      expect(spies.create.mock.calls[0]![0]).toMatchObject({
        projectId: OTHER_PROJECT,
        name: "Golden Set",
        columnTypes,
      });
      expect(spies.createMany).toHaveBeenCalledOnce();
      expect(spies.createMany.mock.calls[0]![0]).toMatchObject({
        datasetId: target.id,
        projectId: OTHER_PROJECT,
        entries: [{ question: "one" }, { question: "two" }],
      });
      expect(target.projectId).toBe(OTHER_PROJECT);
      expect(
        database
          .records()
          .filter((record) => record.datasetId === source.id)
          .map((record) => record.entry),
      ).toEqual([{ question: "one" }, { question: "two" }]);
    });
  });
});

const SERVICES_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");

const RAW_CLIENT_SPECIFIER =
  /^(@aws-sdk\/|@prisma\/|@langwatch\/prisma-client|ioredis|bullmq)|repositories\/(prisma|object-storage|memory)\//;

/** Every module specifier one source file imports. */
function importedSpecifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1]!);
}

describe("the Dataset service sources", () => {
  /** @scenario "Upload storage remains an injected Dataset seam" */
  it("import no object-store client, queue client, global Prisma or concrete repository", () => {
    const sources = readdirSync(SERVICES_DIRECTORY).filter((name) => name.endsWith(".ts"));
    const offending = sources.flatMap((name) =>
      importedSpecifiers(readFileSync(join(SERVICES_DIRECTORY, name), "utf8"))
        .filter((specifier) => RAW_CLIENT_SPECIFIER.test(specifier))
        .map((specifier) => `${name} imports ${specifier}`),
    );

    expect(sources).toContain("dataset.service.ts");
    expect(sources).toContain("dataset-normalize.service.ts");
    expect(offending).toEqual([]);
  });
});

function refusal(error: unknown): unknown {
  return error;
}
