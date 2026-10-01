import { DatasetBatchTooLargeError } from "@langwatch/dataset-contract";
/**
 * @vitest-environment node
 * The tier-aware batch bound: batches above the plan's `datasetBatchMax`
 * refuse with the module's typed error; batches at or under it pass through.
 */
import { describe, expect, it } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetService } from "../dataset.service.ts";

const PROJECT_ID = "project-1";

function service(tier: "free" | "paid" | "enterprise" = "free") {
  const repositories = MemoryDatasetRepositories.create();
  const datasets = DatasetService.create({
    repository: repositories.datasets,
    records: repositories.records,
    generateId: (() => {
      let sequence = 0;
      return () => `record_${++sequence}`;
    })(),
    requestBounds: createDatasetTestRequestBounds(tier),
    attachments: createDatasetTestAttachments(),
  });
  return { datasets };
}

async function withDataset(tier: "free" | "paid" | "enterprise" = "free") {
  const fixtures = service(tier);
  const dataset = await fixtures.datasets.upsertDataset({
    projectId: PROJECT_ID,
    name: "Batch target",
    columnTypes: [{ name: "input", type: "string" }],
  });

  return { ...fixtures, dataset };
}

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ input: `row ${index}` }));

describe("dataset batch bound", () => {
  describe("given a free-tier caller", () => {
    it("refuses an entries batch of 1001 with the typed error naming the free bound", async () => {
      const { datasets, dataset } = await withDataset("free");

      await expect(
        datasets.batchCreateRecords({
          slugOrId: dataset.slug,
          projectId: PROJECT_ID,
          entries: entries(1001),
        }),
      ).rejects.toMatchObject({
        name: "DatasetBatchTooLargeError",
        code: "dataset_batch_too_large",
        meta: { count: 1001, maxEntries: 1000 },
      });
    });

    it("writes an entries batch of exactly 1000", async () => {
      const { datasets, dataset } = await withDataset("free");

      const created = await datasets.batchCreateRecords({
        slugOrId: dataset.slug,
        projectId: PROJECT_ID,
        entries: entries(1000),
      });

      expect(created).toHaveLength(1000);
    });

    it("refuses a recordIds batch of 1001 the same way", async () => {
      const { datasets, dataset } = await withDataset("free");

      await expect(
        datasets.deleteRecords({
          slugOrId: dataset.slug,
          projectId: PROJECT_ID,
          recordIds: Array.from({ length: 1001 }, (_, index) => `record_${index}`),
        }),
      ).rejects.toBeInstanceOf(DatasetBatchTooLargeError);
    });
  });

  describe("given a paid-tier caller", () => {
    it("refuses at 2001 and writes 2000", async () => {
      const { datasets, dataset } = await withDataset("paid");

      await expect(
        datasets.batchCreateRecords({
          slugOrId: dataset.slug,
          projectId: PROJECT_ID,
          entries: entries(2001),
        }),
      ).rejects.toMatchObject({ meta: { count: 2001, maxEntries: 2000 } });

      await expect(
        datasets.batchCreateRecords({
          slugOrId: dataset.slug,
          projectId: PROJECT_ID,
          entries: entries(2000),
        }),
      ).resolves.toHaveLength(2000);
    });
  });

  describe("given an enterprise-tier caller", () => {
    it("refuses at 4001 and writes 4000", async () => {
      const { datasets, dataset } = await withDataset("enterprise");

      await expect(
        datasets.batchCreateRecords({
          slugOrId: dataset.slug,
          projectId: PROJECT_ID,
          entries: entries(4001),
        }),
      ).rejects.toMatchObject({ meta: { count: 4001, maxEntries: 4000 } });

      await expect(
        datasets.batchCreateRecords({
          slugOrId: dataset.slug,
          projectId: PROJECT_ID,
          entries: entries(4000),
        }),
      ).resolves.toHaveLength(4000);
    });
  });
});
