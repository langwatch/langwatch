/**
 * @vitest-environment node
 * The memory twin's move fingerprint answers as the Postgres one does: any add, delete or edit
 * moves its digest, an edit that keeps the record's updated time included.
 */
import { describe, expect, it } from "vitest";

import { MemoryDatasetMigrationRepository } from "../memory.dataset-migration.repository.ts";
import { MemoryDatasetDatabase } from "../memory.dataset.database.ts";

const key = { datasetId: "dataset_1", projectId: "project_1" };

function record(input: { id: string; entry: Record<string, unknown>; updatedAt: Date }) {
  return { ...key, ...input, createdAt: new Date(0) };
}

describe("MemoryDatasetMigrationRepository fingerprint", () => {
  describe("when a record's content changes and its updated time stays the same", () => {
    it("changes the digest", async () => {
      const database = MemoryDatasetDatabase.create();
      const repository = MemoryDatasetMigrationRepository.create({ database });
      database.putRecord(record({ id: "a", entry: { input: "first" }, updatedAt: new Date(5) }));
      const before = await repository.getFingerprint(key);

      database.putRecord(record({ id: "a", entry: { input: "edited" }, updatedAt: new Date(5) }));
      const after = await repository.getFingerprint(key);

      expect(after.count).toBe(before.count);
      expect(after.maxUpdatedAt?.epochMilliseconds).toBe(5);
      expect(after.digest).not.toBe(before.digest);
    });
  });
});
