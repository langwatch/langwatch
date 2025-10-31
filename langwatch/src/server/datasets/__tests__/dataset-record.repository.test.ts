import { describe, it, expect, beforeEach, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";

// Mock StorageService before importing repository to avoid env validation
vi.mock("../../storage", () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    getObject: vi.fn(),
    putObject: vi.fn(),
  })),
}));

import { DatasetRecordRepository } from "../dataset-record.repository";

describe("DatasetRecordRepository", () => {
  let prisma: PrismaClient;
  let repository: DatasetRecordRepository;

  beforeEach(() => {
    prisma = {
      datasetRecord: {
        findMany: vi.fn(),
        update: vi.fn(),
        createMany: vi.fn(),
      },
      $transaction: vi.fn((promises) => Promise.all(promises)),
      dataset: {
        update: vi.fn(),
      },
    } as unknown as PrismaClient;
    repository = new DatasetRecordRepository(prisma);
  });

  describe("findDatasetRecords", () => {
    describe("when records exist for dataset", () => {
      it("returns all records", async () => {
        const mockRecords = [
          { id: "rec-1", datasetId: "ds-1", projectId: "proj-1", entry: {} },
        ];
        vi.mocked(prisma.datasetRecord.findMany).mockResolvedValue(mockRecords as any);

        const result = await repository.findDatasetRecords({
          datasetId: "ds-1",
          projectId: "proj-1",
        });

        expect(result).toEqual(mockRecords);
        expect(prisma.datasetRecord.findMany).toHaveBeenCalledWith({
          where: { datasetId: "ds-1", projectId: "proj-1" },
        });
      });
    });

    describe("when no records exist", () => {
      it("returns empty array", async () => {
        vi.mocked(prisma.datasetRecord.findMany).mockResolvedValue([]);

        const result = await repository.findDatasetRecords({
          datasetId: "ds-1",
          projectId: "proj-1",
        });

        expect(result).toEqual([]);
      });
    });
  });

  describe("updateDatasetRecordsTransaction", () => {
    describe("when updating multiple records", () => {
      it("updates all records atomically", async () => {
        vi.mocked(prisma.datasetRecord.update).mockResolvedValue({} as any);

        await repository.updateDatasetRecordsTransaction(
          "proj-1",
          [
            { id: "rec-1", entry: { field: "value1" } },
            { id: "rec-2", entry: { field: "value2" } },
          ]
        );

        expect(prisma.$transaction).toHaveBeenCalled();
      });

      it("enforces projectId on all records", async () => {
        vi.mocked(prisma.datasetRecord.update).mockResolvedValue({} as any);

        await repository.updateDatasetRecordsTransaction("proj-1", [
          { id: "rec-1", entry: { field: "value" } },
        ]);

        expect(prisma.datasetRecord.update).toHaveBeenCalledWith({
          where: { id: "rec-1", projectId: "proj-1" },
          data: { entry: { field: "value" } },
        });
      });
    });
  });

  describe("batchCreate", () => {
    describe("when using Prisma storage", () => {
      it("creates all records via createMany", async () => {
        vi.mocked(prisma.datasetRecord.createMany).mockResolvedValue({ count: 2 } as any);

        await repository.batchCreate({
          datasetId: "ds-1",
          projectId: "proj-1",
          datasetRecords: [{ field: "value1" }, { field: "value2" }],
          useS3: false,
        });

        expect(prisma.datasetRecord.createMany).toHaveBeenCalled();
      });

      it("sets correct projectId and datasetId on all records", async () => {
        vi.mocked(prisma.datasetRecord.createMany).mockResolvedValue({ count: 1 } as any);

        await repository.batchCreate({
          datasetId: "ds-1",
          projectId: "proj-1",
          datasetRecords: [{ field: "value" }],
          useS3: false,
        });

        const callArgs = vi.mocked(prisma.datasetRecord.createMany).mock.calls[0][0];
        expect(callArgs.data[0]).toMatchObject({
          datasetId: "ds-1",
          projectId: "proj-1",
        });
      });
    });
  });
});

