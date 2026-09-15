import type { DatasetActionParams } from "@langwatch/automation-contract";
import type { TraceRecord } from "@langwatch/trace-contract";

export abstract class AutomationDatasetMapper {
  abstract map(input: {
    trace: TraceRecord;
    mapping: DatasetActionParams["datasetMapping"]["mapping"];
    expansions: readonly string[];
  }): Array<Record<string, string | number>>;
}
