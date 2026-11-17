import { DatasetRecordsTableWriteRefusedError } from "@langwatch/dataset-contract";

/** Where a dataset row says its rows live: the two columns the records-table guard reads. */
export type DatasetRowsHome = { id: string; contentLayout: string; useS3: boolean };

/**
 * Refuses a records-table write for a dataset whose rows live in object storage, as chunks or
 * as one older single file (ADR-032 I-PG). A dataset row that is not there is left to the
 * table's own foreign key.
 */
export function assertRecordsTableHolds(dataset: DatasetRowsHome | null): void {
  if (!dataset) return;
  if (dataset.contentLayout !== "postgres" || dataset.useS3) {
    throw new DatasetRecordsTableWriteRefusedError(dataset.id);
  }
}
