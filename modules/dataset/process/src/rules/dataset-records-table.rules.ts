import {
  DatasetNotFoundError,
  DatasetRecordsTableWriteRefusedError,
} from "@langwatch/dataset-contract";

/** Where a dataset row says its rows live: the two columns the records-table guard reads. */
export type DatasetRowsHome = { id: string; contentLayout: string; useS3: boolean };

/**
 * Refuses a records-table write for a dataset whose rows live in object storage, as chunks or
 * as one older single file (ADR-032 I-PG). relationMode is "prisma", so no foreign key catches
 * a row for a dataset that is gone: storing one is refused too, removing leftovers is not.
 */
export function assertRecordsTableHolds({
  dataset,
  write,
}: {
  dataset: DatasetRowsHome | null;
  write: "store" | "remove";
}): void {
  if (!dataset) {
    if (write === "remove") return;
    throw new DatasetNotFoundError();
  }
  if (dataset.contentLayout !== "postgres" || dataset.useS3) {
    throw new DatasetRecordsTableWriteRefusedError(dataset.id);
  }
}
