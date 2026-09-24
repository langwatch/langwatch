import type { Span, TraceApi } from "@langwatch/trace-contract";

import type { EvaluationSpanDigest } from "../app/evaluation.members.ts";

/** The `formatted_trace` digest an evaluator reads, rendered by trace. */
export class EvaluationSpanDigestService implements EvaluationSpanDigest {
  static create(traces: Pick<TraceApi, "formatSpansDigest">): EvaluationSpanDigestService {
    return new EvaluationSpanDigestService(traces);
  }

  private constructor(private readonly traces: Pick<TraceApi, "formatSpansDigest">) {}

  format(spans: Span[]): Promise<string> {
    return this.traces.formatSpansDigest({ spans });
  }
}
