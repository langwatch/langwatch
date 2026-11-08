import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  DatasetStorageAuditRepository,
  DatasetStorageLeftovers,
} from "../dataset-storage-audit.repository.ts";

/** Only what the counts read, so composition names the slice it needs. */
type DatasetStorageAuditDatabase = Pick<PrismaClient, "dataset" | "datasetRecord" | "$queryRaw">;

/** Counts one project's leftovers; every query names the project, archived datasets included. */
export class PrismaDatasetStorageAuditRepository implements DatasetStorageAuditRepository {
  static create(options: { database: DatasetStorageAuditDatabase }) {
    return new PrismaDatasetStorageAuditRepository(options.database);
  }

  private constructor(private readonly database: DatasetStorageAuditDatabase) {}

  async countLeftovers({ projectId }: { projectId: string }): Promise<DatasetStorageLeftovers> {
    const recordsTable = { projectId, contentLayout: "postgres", useS3: false };
    const [
      recordsTableDatasets,
      recordsTableRows,
      singleFileDatasets,
      rowsAwaitingCleanup,
      rowsUnderOtherProject,
      orphans,
    ] = await Promise.all([
      this.database.dataset.count({ where: recordsTable }),
      this.database.datasetRecord.count({ where: { projectId, dataset: recordsTable } }),
      this.database.dataset.count({
        where: { projectId, contentLayout: "postgres", useS3: true },
      }),
      this.database.datasetRecord.count({
        where: { projectId, dataset: { projectId, contentLayout: "s3_jsonl" } },
      }),
      this.database.datasetRecord.count({
        where: { projectId, dataset: { projectId: { not: projectId } } },
      }),
      // The schema keeps no foreign key on the records table, so a row can outlive its dataset.
      this.database.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count
          FROM "DatasetRecord" r
         WHERE r."projectId" = ${projectId}
           AND NOT EXISTS (SELECT 1 FROM "Dataset" d WHERE d."id" = r."datasetId")
      `,
    ]);
    return {
      recordsTableDatasets,
      recordsTableRows,
      singleFileDatasets,
      rowsAwaitingCleanup,
      rowsUnderOtherProject,
      orphanRows: Number(orphans[0]?.count ?? 0n),
    };
  }
}
