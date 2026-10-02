import type { Trace, TraceApi } from "@langwatch/trace-contract";

/**
 * A thread monitor judges what the agent did, so `formatted_traces` is the
 * steps view: each turn with its tool calls and results.
 * @see specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature
 */
const EVALUATION_THREAD_VIEW = "steps";

type DigestRenderers = Pick<TraceApi, "renderReadableTrace" | "renderThreadTranscript">;

/**
 * The `formatted_trace` and `formatted_traces` texts an evaluator reads,
 * rendered under the judge's budget: a long trace keeps its tool calls and
 * errors first, a long thread shortens turn by turn, and neither is skipped.
 */
export class EvaluationSpanDigestService {
  static create(traces: DigestRenderers): EvaluationSpanDigestService {
    return new EvaluationSpanDigestService(traces);
  }

  private constructor(private readonly traces: DigestRenderers) {}

  format({ trace, maxTokens }: { trace: Trace; maxTokens: number }): Promise<string> {
    return this.traces.renderReadableTrace({ trace, maxTokens });
  }

  formatThread({
    threadKey,
    traces,
    maxTokens,
  }: {
    threadKey: string;
    traces: readonly Trace[];
    maxTokens: number;
  }): Promise<string> {
    return this.traces.renderThreadTranscript({
      threadKey,
      traces: traces.toSorted((a, b) => a.timestamps.started_at - b.timestamps.started_at),
      view: EVALUATION_THREAD_VIEW,
      maxTokens,
    });
  }
}
