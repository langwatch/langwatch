import type { DatasetRecord, DatasetRecordInput } from "@langwatch/dataset-contract";

export abstract class DatasetRecordRepository {
  abstract list(input: {
    datasetId: string;
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ records: DatasetRecord[]; total: number }>;
  abstract createMany(input: {
    datasetId: string;
    projectId: string;
    entries: Array<DatasetRecordInput & { id: string }>;
  }): Promise<DatasetRecord[]>;
  abstract update(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
  }): Promise<DatasetRecord>;
  abstract deleteMany(input: {
    datasetId: string;
    projectId: string;
    recordIds: string[];
  }): Promise<number>;
}
