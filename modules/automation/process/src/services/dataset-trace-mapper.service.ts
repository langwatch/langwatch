import type { DatasetActionParams } from "@langwatch/automation-contract";
import { mapTraceToDatasetEntry, TRACE_EXPANSIONS } from "@langwatch/dataset-contract";
import {
  legacySpanInputOutputSchema,
  traceSchema,
  type TraceRecord,
} from "@langwatch/trace-contract";

import { AutomationDatasetMapper } from "../features/runaway/services/persist-action.service.ts";

/**
 * Ingest stores span input/output as sent, so chat messages can carry parts the strict shape
 * rejects (AI SDK UI parts such as `step-start`). The previous release mapped them unparsed:
 * such a value keeps its stored value under the `json` type, so dataset columns read the same.
 */
function readableSpanIo(io: unknown): unknown {
  if (io === null || io === undefined) {
    return io;
  }

  const stored: unknown = io;
  if (legacySpanInputOutputSchema.validate(stored)) {
    return stored;
  }

  const value = typeof io === "object" && !Array.isArray(io) && "value" in io ? io.value : io;

  return { type: "json", value: value ?? null };
}

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
    const trace = {
      ...input.trace,
      spans: input.trace.spans.map((span) => ({
        ...span,
        input: readableSpanIo(span.input),
        output: readableSpanIo(span.output),
      })),
    };
    return mapTraceToDatasetEntry({
      trace: traceSchema.parse(trace),
      mapping: input.mapping,
      expansions,
    });
  }
}
