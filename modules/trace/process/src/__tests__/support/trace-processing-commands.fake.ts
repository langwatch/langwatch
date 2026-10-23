import type { QueueSendResult } from "@langwatch/eventing";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";

import type { TraceProcessingCommands } from "../../services/trace-processing-commands.service.ts";

/**
 * Trace's commands with only the span hand-off doing anything: `recordSpans` hands each span to
 * `recordSpan` in turn and answers as the queue would, a throw being an unknown outcome.
 */
export function fakeTraceProcessingCommands({
  recordSpan = async () => undefined,
}: {
  recordSpan?: (data: RecordSpanCommandData) => Promise<unknown>;
} = {}): TraceProcessingCommands {
  return {
    recordSpan,
    recordSpans: async (data) => {
      const results: QueueSendResult[] = [];
      for (const span of data) {
        try {
          await recordSpan(span);
          results.push({ status: "staged" });
        } catch (error) {
          results.push({ status: "unknown", error });
        }
      }
      return results;
    },
    changeTraceName: async () => undefined,
    addAnnotation: async () => undefined,
    removeAnnotation: async () => undefined,
    assignTopic: async () => undefined,
  };
}
