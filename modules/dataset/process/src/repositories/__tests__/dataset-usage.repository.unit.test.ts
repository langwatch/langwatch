/**
 * The usage report's dataset figures, over the memory twin.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { describe, expect, it } from "vitest";

import type { DatasetRow } from "../dataset.repository.ts";
import { MemoryDatasetUsageRepository } from "../memory/memory.dataset-usage.repository.ts";
import { MemoryDatasetDatabase } from "../memory/memory.dataset.database.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 21);

function datasetOn({ projectId, at }: { projectId: string; at: number }): DatasetRow {
  return {
    id: `ds_${projectId}_${at}`,
    projectId,
    name: "Dataset",
    slug: `dataset-${at}`,
    columnTypes: [],
    mapping: null,
    useS3: false,
    s3RecordCount: null,
    contentLayout: "postgres",
    status: "ready",
    statusError: null,
    stagingKey: null,
    sourceStoredObjectId: null,
    uploadFilename: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
    createdAt: new Date(at),
    updatedAt: new Date(at),
    archivedAt: null,
  };
}

describe("given datasets across the install", () => {
  describe("when the usage report counts them", () => {
    it("counts only the named projects, windows by creation and dates the first", async () => {
      const database = MemoryDatasetDatabase.create();
      database
        .datasets()
        .push(
          datasetOn({ projectId: "p1", at: NOW - 30 * DAY }),
          datasetOn({ projectId: "p1", at: NOW - DAY }),
          datasetOn({ projectId: "other", at: NOW - 60 * DAY }),
        );
      const usage = MemoryDatasetUsageRepository.create({ database });

      const lifetime = await usage.countUsage({ projectIds: ["p1"] });
      const lastWeek = await usage.countUsage({ projectIds: ["p1"], since: NOW - 7 * DAY });

      expect(lifetime).toEqual({
        datasets: 2,
        datasetRecords: 0,
        batchEvaluations: 0,
        firstDatasetAt: NOW - 30 * DAY,
      });
      expect(lastWeek.datasets).toBe(1);
    });
  });
});
