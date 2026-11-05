import type {
  DatasetColumns,
  DatasetRecord,
  DatasetRecordInput,
} from "@langwatch/dataset-contract";

/** The record table under one dataset's lock, with the dataset's columns as committed. */
export interface LockedDatasetRecords extends Omit<DatasetRecordRepository, "withDatasetLock"> {
  columnTypes(): Promise<DatasetColumns>;
  setColumnTypes(columnTypes: DatasetColumns): Promise<void>;
}

export interface DatasetRecordRepository {
  /**
   * Runs `work` in one transaction holding the dataset's advisory lock, the one the chunked
   * and single-file writes take, so record writes and column edits never interleave.
   */
  withDatasetLock<T>(
    input: { datasetId: string; projectId: string },
    work: (locked: LockedDatasetRecords) => Promise<T>,
  ): Promise<T>;
  count(input: { datasetId: string; projectId: string }): Promise<number>;
  /** One grouped count for these datasets; a dataset holding no entries is absent. */
  countByDataset(input: {
    projectId: string;
    datasetIds: readonly string[];
  }): Promise<{ datasetId: string; recordCount: number }[]>;
  findPage(input: {
    datasetId: string;
    projectId: string;
    limit: number;
    cursorId?: string;
  }): Promise<DatasetRecord[]>;
  findByIds(input: {
    datasetId: string;
    projectId: string;
    ids: readonly string[];
  }): Promise<DatasetRecord[]>;
  listAll(input: {
    datasetId: string;
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ records: DatasetRecord[]; total: number }>;
  createMany(input: {
    datasetId: string;
    projectId: string;
    entries: (DatasetRecordInput & { id: string })[];
  }): Promise<DatasetRecord[]>;
  update(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
  }): Promise<DatasetRecord>;
  deleteMany(input: { datasetId: string; projectId: string; recordIds: string[] }): Promise<number>;
  /**
   * Replaces every entry of the dataset at once, read back in the order given: a failure part
   * way keeps the old entries.
   */
  replaceAll(input: {
    datasetId: string;
    projectId: string;
    entries: (DatasetRecordInput & { id: string })[];
  }): Promise<void>;
}
