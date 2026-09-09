import type { DatasetRecord, DatasetRecordInput } from "@langwatch/dataset-contract";

export interface DatasetRecordRepository {
  list(input: {
    datasetId: string;
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ records: DatasetRecord[]; total: number }>;
  createMany(input: {
    datasetId: string;
    projectId: string;
    entries: Array<DatasetRecordInput & { id: string }>;
  }): Promise<DatasetRecord[]>;
  update(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
  }): Promise<DatasetRecord>;
  deleteMany(input: {
    datasetId: string;
    projectId: string;
    recordIds: string[];
  }): Promise<number>;
}
