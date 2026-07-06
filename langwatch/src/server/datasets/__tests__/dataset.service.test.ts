import { describe, expect, it, vi } from "vitest";
import { DatasetService } from "../dataset.service";
import {
  DATASET_MUTATION_TXN_MAX_WAIT_MS,
  DATASET_MUTATION_TXN_TIMEOUT_MS,
} from "../dataset-lock";

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

      // Regression for the reported P2028 timeout. In the legacy postgres layout
      // a type-only column change (e.g. string→image) is metadata: the untyped
      // `entry` JSON is unaffected, and the record migrator only remaps keys. So
      // it must NOT rewrite a single row — doing so was O(rowCount) no-op UPDATEs
      // that blew the 5s transaction budget on large datasets. A genuine rename
      // still migrates, under the wider budget as a safety net.
      const makeLegacyDataset = (
        columnTypes: Array<{ name: string; type: string }>,
      ) => ({
        id: "dataset_legacy",
        projectId: "project_1",
        name: "products_image_urls",
        slug: "products-image-urls",
        status: "ready",
        statusError: null,
        contentLayout: "postgres",
        columnTypes,
      });

      const makeDeps = (
        existing: ReturnType<typeof makeLegacyDataset>,
        records: Array<{ id: string; entry: Record<string, unknown> }> = [],
      ) => {
        let capturedOptions: { timeout?: number; maxWait?: number } | null =
          null;
        const fakeTx = {} as never;
        const prisma = {
          $transaction: vi.fn(async (cb: any, options: any) => {
            capturedOptions = options;
            return await cb(fakeTx);
          }),
        };
        const repository = {
          findOne: vi.fn().mockResolvedValue(existing),
          findBySlug: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue(existing),
        };
        const recordRepository = {
          findDatasetRecords: vi.fn().mockResolvedValue(records),
          updateDatasetRecordsTransaction: vi.fn().mockResolvedValue(void 0),
        };
        const service = new DatasetService(
          prisma as never,
          repository as never,
          recordRepository as never,
          {} as never,
        );
        return {
          service,
          prisma,
          repository,
          recordRepository,
          options: () => capturedOptions,
        };
      };

      describe("when only a column type changes (no rename)", () => {
        it("skips the per-row migration entirely", async () => {
          const deps = makeDeps(
            makeLegacyDataset([{ name: "image_url", type: "string" }]),
          );

          await deps.service.upsertDataset({
            projectId: "project_1",
            datasetId: "dataset_legacy",
            name: "products_image_urls",
            columnTypes: [{ name: "image_url", type: "image" }] as never,
          });

          expect(
            deps.recordRepository.findDatasetRecords,
          ).not.toHaveBeenCalled();
          expect(
            deps.recordRepository.updateDatasetRecordsTransaction,
          ).not.toHaveBeenCalled();
          // The new types are still persisted.
          expect(deps.repository.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                columnTypes: [{ name: "image_url", type: "image" }],
              }),
            }),
            expect.anything(),
          );
        });

        it("preserves entry keys not in the column list (no scrub)", async () => {
          // Legacy datasets can carry entry keys outside columnTypes. The
          // migration policy is faithful copy — post == pre — so a type-only
          // edit must NOT drop them. The migrator (which DOES drop stray keys)
          // stays skipped; scrubbing is the deferred "rectangular" decision,
          // not a side effect of a retype.
          const deps = makeDeps(
            makeLegacyDataset([{ name: "image_url", type: "string" }]),
            [{ id: "rec_1", entry: { image_url: "http://x", selected: true } }],
          );

          await deps.service.upsertDataset({
            projectId: "project_1",
            datasetId: "dataset_legacy",
            name: "products_image_urls",
            columnTypes: [{ name: "image_url", type: "image" }] as never,
          });

          // No row rewrite at all → the stray `selected` key survives untouched.
          expect(
            deps.recordRepository.findDatasetRecords,
          ).not.toHaveBeenCalled();
          expect(
            deps.recordRepository.updateDatasetRecordsTransaction,
          ).not.toHaveBeenCalled();
        });
      });

      describe("when columns are only reordered (no rename/add/remove)", () => {
        it("skips the per-row migration entirely", async () => {
          // A pure reorder is the same no-op as a type-only change: the migrator
          // matches every column to itself by name, so each row would be
          // rewritten byte-identically. Column order is metadata, persisted by
          // the dataset.update — never the row JSON.
          const deps = makeDeps(
            makeLegacyDataset([
              { name: "question", type: "string" },
              { name: "answer", type: "string" },
            ]),
            [{ id: "rec_1", entry: { question: "q", answer: "a" } }],
          );

          await deps.service.upsertDataset({
            projectId: "project_1",
            datasetId: "dataset_legacy",
            name: "products_image_urls",
            columnTypes: [
              { name: "answer", type: "string" },
              { name: "question", type: "string" },
            ] as never,
          });

          expect(
            deps.recordRepository.findDatasetRecords,
          ).not.toHaveBeenCalled();
          expect(
            deps.recordRepository.updateDatasetRecordsTransaction,
          ).not.toHaveBeenCalled();
          // The reordered columns are still persisted.
          expect(deps.repository.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                columnTypes: [
                  { name: "answer", type: "string" },
                  { name: "question", type: "string" },
                ],
              }),
            }),
            expect.anything(),
          );
        });
      });

      describe("when a column is renamed on a legacy dataset", () => {
        it("remaps each row's value to the new column key", async () => {
          const deps = makeDeps(
            makeLegacyDataset([{ name: "old_name", type: "string" }]),
            [
              { id: "rec_1", entry: { old_name: "alpha" } },
              { id: "rec_2", entry: { old_name: "beta" } },
            ],
          );

          await deps.service.upsertDataset({
            projectId: "project_1",
            datasetId: "dataset_legacy",
            name: "products_image_urls",
            columnTypes: [{ name: "new_name", type: "string" }] as never,
          });

          // Data survives the rename: the value moves old_name → new_name.
          expect(
            deps.recordRepository.updateDatasetRecordsTransaction,
          ).toHaveBeenCalledWith(
            "project_1",
            [
              { id: "rec_1", entry: { new_name: "alpha" } },
              { id: "rec_2", entry: { new_name: "beta" } },
            ],
            expect.anything(),
          );
        });

        it("runs the migration under the wide transaction budget, not the 5s default", async () => {
          const deps = makeDeps(
            makeLegacyDataset([{ name: "old_name", type: "string" }]),
            [{ id: "rec_1", entry: { old_name: "alpha" } }],
          );

          await deps.service.upsertDataset({
            projectId: "project_1",
            datasetId: "dataset_legacy",
            name: "products_image_urls",
            columnTypes: [{ name: "new_name", type: "string" }] as never,
          });

          expect(deps.recordRepository.findDatasetRecords).toHaveBeenCalled();
          expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1);
          expect(deps.options()?.timeout).toBe(DATASET_MUTATION_TXN_TIMEOUT_MS);
          expect(deps.options()?.timeout).toBeGreaterThan(5_000);
          expect(deps.options()?.maxWait).toBe(
            DATASET_MUTATION_TXN_MAX_WAIT_MS,
          );
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
