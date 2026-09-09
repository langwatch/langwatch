import type { DatasetActionParams } from "@langwatch/automation-contract";
import type { DatasetRecordEntry } from "@langwatch/dataset-contract";
import type { TraceRecord } from "@langwatch/trace-contract";

export abstract class AutomationDatasetMapperPort {
  abstract map(input: {
    trace: TraceRecord;
    mapping: DatasetActionParams["datasetMapping"]["mapping"];
    expansions: readonly string[];
  }): Array<Record<string, string | number>>;
}

export abstract class AutomationPersistActionWriterPort {
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
