/** What one project still keeps outside object-storage chunks, as the storage audit counts it. */
export type DatasetStorageLeftovers = {
  /** Datasets whose rows are still in the records table: the content move takes them. */
  recordsTableDatasets: number;
  /** Their rows, filed under the dataset's own project. */
  recordsTableRows: number;
  /** Datasets an older release kept as one file: the single-file conversion takes them. */
  singleFileDatasets: number;
  /** Records-table rows of datasets already in object storage, left for the cleanup. */
  rowsAwaitingCleanup: number;
  /** Rows filed under this project whose dataset belongs to another one: never moved. */
  rowsUnderOtherProject: number;
  /** Rows filed under this project whose dataset no longer exists. */
  orphanRows: number;
};

/** Read-only counts over the dataset tables; nothing here writes. */
export interface DatasetStorageAuditRepository {
  countLeftovers(input: { projectId: string }): Promise<DatasetStorageLeftovers>;
}
