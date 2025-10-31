import { describe, it, expect, beforeEach, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";

// Mock StorageService before importing to avoid env validation
vi.mock("../../storage", () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    getObject: vi.fn(),
    putObject: vi.fn(),
  })),
}));

import { DatasetService } from "../dataset.service";
import { DatasetRepository } from "../dataset.repository";
import { DatasetRecordRepository } from "../dataset-record.repository";
import { ExperimentRepository } from "../experiment.repository";
import { DatasetConflictError, DatasetNotFoundError } from "../errors";

describe("DatasetService", () => {
  let prisma: PrismaClient;
  let service: DatasetService;
  let datasetRepo: DatasetRepository;
  let recordRepo: DatasetRecordRepository;
  let experimentRepo: ExperimentRepository;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn((callback) => callback(prisma)),
    } as unknown as PrismaClient;

    datasetRepo = {
      findOne: vi.fn(),
      findBySlug: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findAllSlugs: vi.fn(),
      getProjectWithOrgS3Settings: vi.fn(),
    } as unknown as DatasetRepository;

    recordRepo = {
      findDatasetRecords: vi.fn(),
      updateDatasetRecordsTransaction: vi.fn(),
      batchCreate: vi.fn(),
    } as unknown as DatasetRecordRepository;

    experimentRepo = {
      findExperiment: vi.fn(),
    } as unknown as ExperimentRepository;

    service = new DatasetService(prisma, datasetRepo, recordRepo, experimentRepo);
  });

  describe("validateDatasetName", () => {
    describe("when slug is available", () => {
      it("returns available=true", async () => {
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);

        const result = await service.validateDatasetName({
          projectId: "proj-1",
          proposedName: "My Dataset",
        });

        expect(result.available).toBe(true);
      });

      it("returns computed slug", async () => {
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);

        const result = await service.validateDatasetName({
          projectId: "proj-1",
          proposedName: "My Dataset",
        });

        expect(result.slug).toBe("my-dataset");
      });
    });

    describe("when slug conflicts", () => {
      it("returns available=false", async () => {
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue({
          id: "ds-1",
          name: "Existing Dataset",
          slug: "my-dataset",
        } as any);

        const result = await service.validateDatasetName({
          projectId: "proj-1",
          proposedName: "My Dataset",
        });

        expect(result.available).toBe(false);
      });

      it("returns conflictsWith dataset name", async () => {
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue({
          id: "ds-1",
          name: "Existing Dataset",
          slug: "my-dataset",
        } as any);

        const result = await service.validateDatasetName({
          projectId: "proj-1",
          proposedName: "My Dataset",
        });

        expect(result.conflictsWith).toBe("Existing Dataset");
      });
    });

    describe("when editing existing dataset", () => {
      it("excludes current dataset from conflict check", async () => {
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);

        await service.validateDatasetName({
          projectId: "proj-1",
          proposedName: "My Dataset",
          excludeDatasetId: "ds-1",
        });

        expect(datasetRepo.findBySlug).toHaveBeenCalledWith({
          slug: "my-dataset",
          projectId: "proj-1",
          excludeId: "ds-1",
        });
      });
    });
  });

  describe("upsertDataset", () => {
    describe("when creating new dataset", () => {
      it("generates slug from name", async () => {
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);
        vi.mocked(datasetRepo.getProjectWithOrgS3Settings).mockResolvedValue({
          canUseS3: false,
        });
        vi.mocked(datasetRepo.create).mockResolvedValue({
          id: "ds-1",
          slug: "test-dataset",
        } as any);

        await service.upsertDataset({
          projectId: "proj-1",
          name: "Test Dataset",
          columnTypes: [],
        });

        expect(datasetRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            slug: "test-dataset",
          }),
          expect.any(Object)
        );
      });

      it("throws DatasetConflictError if slug exists", async () => {
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue({
          id: "ds-1",
          name: "Existing",
        } as any);

        await expect(
          service.upsertDataset({
            projectId: "proj-1",
            name: "Test Dataset",
            columnTypes: [],
          })
        ).rejects.toThrow(DatasetConflictError);
      });
    });

    describe("when updating existing dataset", () => {
      it("updates slug when name changes", async () => {
        vi.mocked(datasetRepo.findOne).mockResolvedValue({
          id: "ds-1",
          name: "Old Name",
          slug: "old-name",
          columnTypes: [],
        } as any);
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);
        vi.mocked(datasetRepo.update).mockResolvedValue({
          id: "ds-1",
          slug: "new-name",
        } as any);

        await service.upsertDataset({
          projectId: "proj-1",
          datasetId: "ds-1",
          name: "New Name",
          columnTypes: [],
        });

        expect(datasetRepo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              slug: "new-name",
            }),
          }),
          expect.any(Object)
        );
      });

      it("throws DatasetNotFoundError if dataset missing", async () => {
        vi.mocked(datasetRepo.findOne).mockResolvedValue(null);

        await expect(
          service.upsertDataset({
            projectId: "proj-1",
            datasetId: "missing-id",
            name: "Test",
            columnTypes: [],
          })
        ).rejects.toThrow(DatasetNotFoundError);
      });

      it("throws DatasetConflictError if slug collides with another dataset", async () => {
        vi.mocked(datasetRepo.findOne).mockResolvedValue({
          id: "ds-1",
          columnTypes: [],
        } as any);
        vi.mocked(datasetRepo.findBySlug).mockResolvedValue({
          id: "ds-2",
          name: "Conflicting Dataset",
        } as any);

        await expect(
          service.upsertDataset({
            projectId: "proj-1",
            datasetId: "ds-1",
            name: "Conflicting Dataset",
            columnTypes: [],
          })
        ).rejects.toThrow(DatasetConflictError);
      });
    });
  });

  describe("findNextAvailableName", () => {
    describe("when base name available", () => {
      it("returns base name unchanged", async () => {
        vi.mocked(datasetRepo.findAllSlugs).mockResolvedValue([]);

        const result = await service.findNextAvailableName("proj-1", "Dataset Name");

        expect(result).toBe("Dataset Name");
      });
    });

    describe("when base name conflicts", () => {
      it("returns 'Name (2)' for first conflict", async () => {
        vi.mocked(datasetRepo.findAllSlugs).mockResolvedValue([
          { slug: "dataset-name" },
        ]);

        const result = await service.findNextAvailableName("proj-1", "Dataset Name");

        expect(result).toBe("Dataset Name (2)");
      });

      it("returns 'Name (3)' if (2) also exists", async () => {
        vi.mocked(datasetRepo.findAllSlugs).mockResolvedValue([
          { slug: "dataset-name" },
          { slug: "dataset-name-2" },
        ]);

        const result = await service.findNextAvailableName("proj-1", "Dataset Name");

        expect(result).toBe("Dataset Name (3)");
      });
    });
  });

  describe("generateSlug", () => {
    it("converts to lowercase", async () => {
      vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);

      const result = await service.validateDatasetName({
        projectId: "proj-1",
        proposedName: "UPPERCASE",
      });

      expect(result.slug).toBe("uppercase");
    });

    it("replaces spaces with hyphens", async () => {
      vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);

      const result = await service.validateDatasetName({
        projectId: "proj-1",
        proposedName: "my test dataset",
      });

      expect(result.slug).toBe("my-test-dataset");
    });

    it("replaces ALL underscores with hyphens", async () => {
      vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);

      const result = await service.validateDatasetName({
        projectId: "proj-1",
        proposedName: "my_test_dataset",
      });

      expect(result.slug).toBe("my-test-dataset");
    });

    it("removes special characters", async () => {
      vi.mocked(datasetRepo.findBySlug).mockResolvedValue(null);

      const result = await service.validateDatasetName({
        projectId: "proj-1",
        proposedName: "My @#$% Dataset!",
      });

      expect(result.slug).toBe("my-dollarpercent-dataset");
    });
  });
});

