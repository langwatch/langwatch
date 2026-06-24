import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { DatasetRecordRepository } from "../dataset-record.repository";

/**
 * Unit tests for {@link DatasetRecordRepository} read ordering. Boundary mock:
 * the Prisma client's `datasetRecord.findMany` is a spy so we can assert the
 * exact query shape (`where` + `orderBy`) the repository issues — no DB.
 *
 * The ordering contract matters beyond this repository: the PG→S3 backfill
 * migration reads through `findDatasetRecords`, and a stable, canonical order is
 * what keeps migrated chunk/row order identical to what users saw on the PG read
 * paths (first/last/random/number `entrySelection` parity) and identical across
 * crash-resume re-runs.
 */
describe("DatasetRecordRepository", () => {
  describe("findDatasetRecords()", () => {
    describe("when reading a dataset's records", () => {
      /** @scenario An existing dataset stays usable after the storage migration */
      it("orders by [createdAt asc, id asc] to match the other PG read paths", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        const prisma = {
          datasetRecord: { findMany },
        } as unknown as PrismaClient;
        const repo = new DatasetRecordRepository(prisma);

        await repo.findDatasetRecords({ datasetId: "ds_1", projectId: "p1" });

        expect(findMany).toHaveBeenCalledWith({
          where: { datasetId: "ds_1", projectId: "p1" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
      });
    });

    describe("when a transaction client is provided", () => {
      it("issues the ordered read on the tx client, not the base prisma", async () => {
        const baseFindMany = vi.fn().mockResolvedValue([]);
        const txFindMany = vi.fn().mockResolvedValue([]);
        const prisma = {
          datasetRecord: { findMany: baseFindMany },
        } as unknown as PrismaClient;
        const tx = {
          datasetRecord: { findMany: txFindMany },
        } as never;
        const repo = new DatasetRecordRepository(prisma);

        await repo.findDatasetRecords(
          { datasetId: "ds_1", projectId: "p1" },
          { tx },
        );

        expect(baseFindMany).not.toHaveBeenCalled();
        expect(txFindMany).toHaveBeenCalledWith({
          where: { datasetId: "ds_1", projectId: "p1" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
      });
    });
  });

  describe("findDatasetRecordsPage()", () => {
    describe("when reading the first page (no cursor)", () => {
      /** @scenario A very large dataset migrates without loading every row at once */
      it("reads `take` rows in canonical order with no cursor/skip", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        const prisma = {
          datasetRecord: { findMany },
        } as unknown as PrismaClient;
        const repo = new DatasetRecordRepository(prisma);

        await repo.findDatasetRecordsPage({
          datasetId: "ds_1",
          projectId: "p1",
          take: 1000,
        });

        expect(findMany).toHaveBeenCalledWith({
          where: { datasetId: "ds_1", projectId: "p1" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1000,
        });
      });
    });

    describe("when reading a subsequent page (cursor given)", () => {
      it("keyset-seeks past the cursor row (cursor + skip:1), same order", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        const prisma = {
          datasetRecord: { findMany },
        } as unknown as PrismaClient;
        const repo = new DatasetRecordRepository(prisma);

        await repo.findDatasetRecordsPage({
          datasetId: "ds_1",
          projectId: "p1",
          take: 1000,
          cursorId: "rec_last",
        });

        expect(findMany).toHaveBeenCalledWith({
          where: { datasetId: "ds_1", projectId: "p1" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1000,
          cursor: { id: "rec_last" },
          skip: 1,
        });
      });
    });
  });
});
