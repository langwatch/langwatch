import type { DatasetRecordEntry } from "@langwatch/dataset-contract";

export abstract class AutomationPersistActionWriter {
  abstract addToAnnotationQueue(input: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }): Promise<void>;

  abstract addToDataset(input: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }): Promise<void>;
}
