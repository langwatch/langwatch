import type { DatasetActionParams } from "@langwatch/automation-contract";
import { mapTraceToDatasetEntry, TRACE_EXPANSIONS } from "@langwatch/dataset-contract";
import { traceSchema, type TraceRecord } from "@langwatch/trace-contract";

import { AutomationDatasetMapper } from "./persist-action.service.ts";

/** `ADD_TO_DATASET`'s row mapping, through dataset's own trace mapping (main's worker mapper). */
export class DatasetTraceMapperService extends AutomationDatasetMapper {
  static create(): DatasetTraceMapperService {
    return new DatasetTraceMapperService();
  }

  private constructor() {
    super();
  }

  map(input: {
    trace: TraceRecord;
    mapping: DatasetActionParams["datasetMapping"]["mapping"];
    expansions: readonly string[];
  }): Record<string, string | number>[] {
    const expansions = new Set(
      input.expansions.filter(
        (value): value is keyof typeof TRACE_EXPANSIONS => value in TRACE_EXPANSIONS,
      ),
    );
    return mapTraceToDatasetEntry({
      trace: traceSchema.parse(input.trace),
      mapping: input.mapping,
      expansions,
    });
  }
}
