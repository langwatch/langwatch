/**
 * Records added to a dataset stored in chunks answer with their stored ids.
 * Spec: modules/dataset/specs/dataset-service.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { createDatasetTestApp } from "./dataset.fixture.ts";

const projectId = "project_chunk_ids";

describe("given a new dataset stored in chunks", () => {
  describe("when records are added without ids", () => {
    /** @scenario "Records added to a dataset stored in chunks answer with the ids they were stored under" */
    it("returns the stored ids, which then update and delete those records", async () => {
      const repositories = MemoryDatasetRepositories.create();
      const app = createDatasetTestApp({ repositories });
      const dataset = await app.upsertDataset({
        projectId,
        name: "records",
        columnTypes: [{ name: "input", type: "string" }],
      });
      const added = await app.batchCreateRecords({
        slugOrId: dataset.slug,
        projectId,
        entries: [{ input: "a" }, { input: "b" }, { input: "c" }],
      });
      const stored = await app.listRecords({ slugOrId: dataset.slug, projectId });
      expect(stored.data.map((record) => record.id)).toEqual(added.map((record) => record.id));

      const updated = await app.upsertRecord({
        slugOrId: dataset.slug,
        projectId,
        recordId: added[0]!.id,
        updatedRecord: { input: "edited" },
      });
      const deleted = await app.deleteMatchingRecords({
        slugOrId: dataset.slug,
        projectId,
        recordIds: added.slice(1).map((record) => record.id),
      });

      expect(updated.created).toBe(false);
      expect(deleted).toEqual({ deletedCount: 2 });
      const left = await app.listRecords({ slugOrId: dataset.slug, projectId });
      expect(left.data.map((record) => [record.id, record.entry])).toEqual([
        [added[0]!.id, { input: "edited" }],
      ]);
    });
  });
});
