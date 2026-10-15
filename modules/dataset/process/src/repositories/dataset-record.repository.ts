import type { DatasetRecord, DatasetRecordInput } from "@langwatch/dataset-contract";

export interface DatasetRecordRepository {
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
}
