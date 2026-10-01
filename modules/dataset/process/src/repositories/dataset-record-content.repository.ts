import type { DatasetRecord } from "@langwatch/dataset-contract";

/** Upload writes entries to the relational table. Other reads/writes are in
 * the object-storage backfill's migration repository.
 */
export interface DatasetRecordContentRepository {
  createMany(input: {
    records: { id: string; entry: unknown }[];
    datasetId: string;
    projectId: string;
  }): Promise<DatasetRecord[]>;
}
