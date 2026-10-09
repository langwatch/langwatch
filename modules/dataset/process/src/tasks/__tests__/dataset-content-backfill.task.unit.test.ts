import { describe, expect, it, vi } from "vitest";

import { DatasetContentBackfillSweep } from "../dataset-content-backfill.task.ts";

const migrated = {
  status: "completed" as const,
  summary: {
    migrated: 2,
    wouldMigrate: 0,
    alreadyMigrated: 5,
    skippedConcurrentWrite: 0,
    failed: 0,
  },
};

describe("given a dataset content backfill", () => {
  describe("when the operator asked to skip it", () => {
    it("does not touch the migration at all", async () => {
      const run = vi.fn();

      await DatasetContentBackfillSweep.withMigration({ run }).execute({
        skipped: true,
        dryRun: false,
      });

      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("when it is a dry run", () => {
    it("carries the flag through to the migration rather than deciding twice", async () => {
      const run = vi.fn(() => Promise.resolve(migrated));

      await DatasetContentBackfillSweep.withMigration({ run }).execute({
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
        DatasetContentBackfillSweep.withMigration({ run }).execute({
          skipped: false,
          dryRun: false,
        }),
      ).resolves.toBeUndefined();
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the migration left datasets behind", () => {
    it("fails the task instead of reporting it finished", async () => {
      const run = vi.fn(() =>
        Promise.resolve({
          status: "incomplete" as const,
          summary: { ...migrated.summary, failed: 1 },
        }),
      );

      await expect(
        DatasetContentBackfillSweep.withMigration({ run }).execute({
          skipped: false,
          dryRun: false,
        }),
      ).rejects.toThrow("left 1 failed");
    });
  });
});
