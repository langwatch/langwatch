import type { Span, Trace, TraceApi } from "@langwatch/trace-contract";

import type { EvaluationSpanDigest } from "../app/evaluation.members.ts";

/**
 * The budget a thread is rendered under for `formatted_traces`: well inside
 * the judge's default 128k-token limit even for JSON-dense tool results, so a
 * long thread is shortened turn by turn rather than skipped or cut blind.
 */
export const EVALUATION_THREAD_DIGEST_MAX_TOKENS = 64_000;

type DigestRenderers = Pick<TraceApi, "formatSpansDigest" | "renderThreadTranscript">;

/** The `formatted_trace` and `formatted_traces` texts an evaluator reads, rendered by trace. */
export class EvaluationSpanDigestService implements EvaluationSpanDigest {
  static create(traces: DigestRenderers): EvaluationSpanDigestService {
    return new EvaluationSpanDigestService(traces);
  }

  private constructor(private readonly traces: DigestRenderers) {}

  format(spans: Span[]): Promise<string> {
    return this.traces.formatSpansDigest({ spans });
  }

  formatThread({
    threadKey,
    traces,
  }: {
    threadKey: string;
    traces: readonly Trace[];
  }): Promise<string> {
    return this.traces.renderThreadTranscript({
      threadKey,
      traces: traces.toSorted((a, b) => a.timestamps.started_at - b.timestamps.started_at),
      maxTokens: EVALUATION_THREAD_DIGEST_MAX_TOKENS,
    });
  }
}
