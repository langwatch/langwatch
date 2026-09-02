import { describe, expect, it, vi } from "vitest";
import { DatasetContentBackfillTask } from "../backfill-dataset-content-to-object-storage.task";

const migrated = {
  status: "migrated" as const,
  summary: { datasets: 2, chunks: 7, bytes: 1_024 },
};

describe("given a dataset content backfill", () => {
  describe("when the operator asked to skip it", () => {
    it("does not touch the migration at all", async () => {
      const run = vi.fn();

      await DatasetContentBackfillTask.withMigration({ run }).execute({
        skipped: true,
        dryRun: false,
      });

      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("when it is a dry run", () => {
    it("carries the flag through to the migration rather than deciding twice", async () => {
      const run = vi.fn(() => Promise.resolve(migrated));

      await DatasetContentBackfillTask.withMigration({ run }).execute({
        skipped: false,
        dryRun: true,
      });

      expect(run).toHaveBeenCalledExactlyOnceWith({ dryRun: true });
    });
  });

  describe("when the chunk-layout columns have not been migrated yet", () => {
    it("returns without reporting a summary it does not have", async () => {
      const run = vi.fn(() => Promise.resolve({ status: "schema-pending" as const }));

      await expect(
        DatasetContentBackfillTask.withMigration({ run }).execute({
          skipped: false,
          dryRun: false,
        }),
      ).resolves.toBeUndefined();
      expect(run).toHaveBeenCalledTimes(1);
    });
  });
});
