import { describe, expect, it, vi } from "vitest";
import { DatasetService } from "../dataset.service";
import { DATASET_MUTATION_TXN_TIMEOUT_MS } from "../dataset-lock";

describe("DatasetService", () => {
  describe("validateDatasetName", () => {
    describe("when slug is available", () => {
      it.todo("returns available=true");
      it.todo("returns computed slug");
    });

    describe("when slug conflicts", () => {
      it.todo("returns available=false");
      it.todo("returns conflictsWith dataset name");
    });

    describe("when editing existing dataset", () => {
      it.todo("excludes current dataset from conflict check");
      it.todo("allows keeping same slug");
    });
  });

  describe("upsertDataset", () => {
    describe("when creating new dataset", () => {
      it.todo("generates slug from name");
      it.todo("throws DatasetConflictError if slug exists");
      it.todo("creates dataset with S3 config from org settings");
      it.todo("creates dataset records if provided");
    });

    describe("when updating existing dataset", () => {
      it.todo("updates slug when name changes");
      it.todo("throws DatasetNotFoundError if dataset missing");
      it.todo("triggers column migration when columnTypes differ");
      it.todo("preserves slug format (kebab-case)");
      it.todo(
        "throws DatasetConflictError if slug collides with another dataset",
      );
      it.todo("allows updating with same name/slug without conflict");
      it.todo("wraps all operations in transaction for atomicity");

      // Regression: changing a column type on a LEGACY postgres-layout dataset
      // runs `migrateDatasetRecordColumns` (one UPDATE per row) inside the
      // interactive transaction. Prisma's 5s default timeout P2028s
      // ("Transaction already closed") on any dataset big enough that the
      // per-row UPDATEs take >5s. The transaction MUST be opened with the wider
      // dataset-mutation budget so a legitimately-long migration completes.
      describe("when a legacy postgres dataset changes a column type", () => {
        it("opens the migration transaction with the wide budget, not the 5s default", async () => {
          const legacyDataset = {
            id: "dataset_legacy",
            projectId: "project_1",
            name: "products_image_urls",
            slug: "products-image-urls",
            status: "ready",
            statusError: null,
            contentLayout: "postgres",
            columnTypes: [{ name: "image_url", type: "string" }],
          };

          let capturedOptions: { timeout?: number; maxWait?: number } | null =
            null;
          const fakeTx = {} as never;
          const prisma = {
            $transaction: vi.fn(async (cb: any, options: any) => {
              capturedOptions = options;
              return await cb(fakeTx);
            }),
          } as never;

          const repository = {
            findOne: vi.fn().mockResolvedValue(legacyDataset),
            findBySlug: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue(legacyDataset),
          } as never;
          const recordRepository = {
            findDatasetRecords: vi.fn().mockResolvedValue([]),
            updateDatasetRecordsTransaction: vi.fn().mockResolvedValue(void 0),
          } as never;
          const experimentRepository = {} as never;

          const service = new DatasetService(
            prisma,
            repository,
            recordRepository,
            experimentRepository,
          );

          await service.upsertDataset({
            projectId: "project_1",
            datasetId: "dataset_legacy",
            name: "products_image_urls",
            columnTypes: [{ name: "image_url", type: "image" }] as never,
          });

          expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
          expect(capturedOptions?.timeout).toBe(DATASET_MUTATION_TXN_TIMEOUT_MS);
          expect(capturedOptions?.timeout).toBeGreaterThan(5_000);
        });
      });
    });

    describe("when using experimentId", () => {
      it.todo("resolves name from experiment");
      it.todo("appends (2) if experiment name conflicts");
      it.todo("defaults to 'Draft Dataset' if no experiment");
    });
  });

  describe("findNextAvailableName", () => {
    describe("when base name available", () => {
      it.todo("returns base name unchanged");
    });

    describe("when base name conflicts", () => {
      it.todo("returns 'Name (2)' for first conflict");
      it.todo("returns 'Name (3)' if (2) also exists");
    });
  });

  describe("generateSlug", () => {
    it.todo("converts to lowercase");
    it.todo("replaces spaces with hyphens");
    it.todo("replaces ALL underscores with hyphens");
    it.todo("removes special characters");
  });
});
