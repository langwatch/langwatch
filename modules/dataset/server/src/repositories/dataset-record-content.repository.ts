import type { DatasetRecord } from "@langwatch/dataset-contract";

/**
 * The entries an upload writes into the relational table.
 *
 * One method, because one is what is reached: the upload adapter appends the
 * rows a parsed file produced. The nine reads and writes that sat beside it
 * (paged reads, the count-and-max-updatedAt guard, the transactional entry
 * rewrite) were the object-storage backfill's, and the backfill reads through
 * its own Prisma migration repository instead.
 */
export interface DatasetRecordContentRepository {
  createMany(input: {
    records: Array<{ id: string; entry: unknown }>;
    datasetId: string;
    projectId: string;
  }): Promise<DatasetRecord[]>;
}
