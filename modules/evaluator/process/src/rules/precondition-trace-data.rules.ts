import type { PreconditionTraceData } from "@langwatch/analytics-contract";
import type { CheckPreconditions, Span, Trace } from "@langwatch/trace-contract";

import {
  checkEvaluatorRequiredFields,
  evaluatePreconditions,
} from "./evaluator-preconditions.rules.ts";

type PreconditionTrace = Readonly<{
  input?: { value: string } | null;
  output?: { value: string } | null;
  metadata?: Trace["metadata"];
  expected_output?: { value: string } | null;
  origin?: string | null;
  error?: Trace["error"];
}>;

/** A collector trace and its spans, as the precondition matchers read them. */
export function buildPreconditionTraceDataFromTrace({
  trace,
  spans,
}: {
  trace: PreconditionTrace;
  spans: readonly Span[];
}): PreconditionTraceData {
  const customMetadata: Record<string, string | null> = {};
  for (const [key, val] of Object.entries(trace.metadata?.custom ?? {})) {
    customMetadata[key] = val != null ? String(val) : null;
  }

  return {
    input: trace.input?.value ?? null,
    output: trace.output?.value ?? null,
    origin: trace.origin ?? null,
    hasError: Boolean(trace.error),
    userId: trace.metadata?.user_id ?? null,
    threadId: trace.metadata?.thread_id ?? null,
    customerId: trace.metadata?.customer_id ?? null,
    labels: trace.metadata?.labels ?? null,
    promptIds: trace.metadata?.prompt_ids ?? null,
    topicId: trace.metadata?.topic_id ?? null,
    subTopicId: trace.metadata?.subtopic_id ?? null,
    spanTypes: spans.map((span) => span.type),
    spanModels: spans
      .map((span) => ("model" in span ? span.model : undefined))
      .filter((model): model is string => typeof model === "string" && model !== ""),
    customMetadata: Object.keys(customMetadata).length > 0 ? customMetadata : null,
    attributes: null,
    annotationIds: [],
    events: null,
  };
}

/** Main's getSampleTraces match: the evaluator's required fields, then every precondition. */
export function findTraceIdsPassingPreconditions({
  evaluatorType,
  preconditions,
  traces,
}: {
  evaluatorType: string;
  preconditions: CheckPreconditions;
  traces: readonly Trace[];
}): string[] {
  return traces
    .filter((trace) => {
      const spans = trace.spans ?? [];
      if (
        !checkEvaluatorRequiredFields({
          evaluatorType,
          spans,
          expectedOutput: trace.expected_output,
        })
      ) {
        return false;
      }

      return evaluatePreconditions({
        traceData: buildPreconditionTraceDataFromTrace({ trace, spans }),
        preconditions,
      });
    })
    .map((trace) => trace.trace_id);
}
