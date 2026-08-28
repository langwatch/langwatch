import { afterEach, describe, expect, it, vi } from "vitest";

const migration = vi.hoisted(() => ({
  create: vi.fn(),
  run: vi.fn(),
  closeStorage: vi.fn(async () => {}),
}));

vi.mock("../../server/db", () => ({ prisma: {} }));
vi.mock("@langwatch/dataset-server", () => ({
  PostgresDatasetMigrationAdapter: { create: migration.create },
}));
vi.mock("../../runtime/app/features/dataset-storage", () => ({
  AppDatasetStorageResolver: class {
    close = migration.closeStorage;
  },
}));

import execute from "../backfillDatasetContentToS3";

afterEach(() => {
  delete process.env.DATASET_S3_MIGRATE_DRY_RUN;
  delete process.env.SKIP_DATASET_S3_MIGRATE;
  vi.clearAllMocks();
});

describe("backfillDatasetContentToS3 task", () => {
  it("does not compose the migration when the task is disabled", async () => {
    process.env.SKIP_DATASET_S3_MIGRATE = "1";

    await execute();

    expect(migration.create).not.toHaveBeenCalled();
  });

  it("passes dry-run configuration to the package adapter", async () => {
    process.env.DATASET_S3_MIGRATE_DRY_RUN = "1";
    migration.create.mockReturnValue({ run: migration.run });
    migration.run.mockResolvedValue({
      status: "completed",
      summary: {
        migrated: 0,
        wouldMigrate: 1,
        alreadyMigrated: 0,
        skippedConcurrentWrite: 0,
        failed: 0,
      },
    });

    await execute();

    expect(migration.run).toHaveBeenCalledWith({ dryRun: true });
    expect(migration.closeStorage).toHaveBeenCalledOnce();
  });
});
