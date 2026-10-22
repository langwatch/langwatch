import type { Logger } from "@langwatch/observability";
import type { Span, TraceCanonicalisationService } from "@langwatch/trace-contract";

import {
  enrichClaudeInteractionInputs,
  enrichSpansWithClaudeLogContent,
  hasCodingAgentJoinableSpans,
  type TraceLogRecordBatchReader,
  type TraceLogRecordReader,
} from "../rules/claude-code-log-enrichment.rules.ts";

type ClaudeCodeLogEnrichmentDependencies<Reader extends TraceLogRecordReader> = {
  logRecords: Reader;
  traceCanonicalisation: TraceCanonicalisationService;
  logger?: Logger;
};

/** Joins Claude Code log content onto a trace's spans, reading the trace's logs once. */
export class ClaudeCodeLogEnrichmentService<
  Reader extends TraceLogRecordReader = TraceLogRecordReader,
> {
  readonly #dependencies: ClaudeCodeLogEnrichmentDependencies<Reader>;

  static create<Reader extends TraceLogRecordReader>(
    dependencies: ClaudeCodeLogEnrichmentDependencies<Reader>,
  ): ClaudeCodeLogEnrichmentService<Reader> {
    return new ClaudeCodeLogEnrichmentService(dependencies);
  }

  private constructor(dependencies: ClaudeCodeLogEnrichmentDependencies<Reader>) {
    this.#dependencies = dependencies;
  }

  /**
   * Gates on the trace having Claude model-call spans, does one lazy partition-pruned log read,
   * and joins content onto the spans. Best-effort: tokens, timings and tool calls are still worth
   * showing without content, so a failed read keeps the attribute-only interaction input.
   */
  async enrichCodingAgentSpansFromLogs({
    tenantId,
    traceId,
    spans,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    spans: Span[];
    /** Partition-pruning hint on the log store's `TimeUnixMs` partition key. */
    occurredAtMs?: number;
  }): Promise<Span[]> {
    if (!hasCodingAgentJoinableSpans(spans)) {
      return spans;
    }
    const { logRecords, traceCanonicalisation, logger } = this.#dependencies;

    try {
      const logRows = await logRecords.getLogsByTraceId({ tenantId, traceId, occurredAtMs });

      return enrichSpansWithClaudeLogContent({
        spans,
        logRows,
        traceCanonicalisation,
      });
    } catch (error) {
      logger?.warn(
        {
          tenantId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Claude Code log enrichment skipped: failed to read trace logs",
      );

      return enrichClaudeInteractionInputs(spans);
    }
  }

  /**
   * {@link enrichCodingAgentSpansFromLogs} for a batch of traces, reading all their logs in one
   * statement per store rather than one per trace, answering each trace's spans in input order.
   * Needs a batch reader. A failed read keeps attribute-only inputs.
   */
  async enrichManyCodingAgentSpansFromLogs(
    this: ClaudeCodeLogEnrichmentService<TraceLogRecordReader & TraceLogRecordBatchReader>,
    {
      tenantId,
      traces,
    }: {
      tenantId: string;
      traces: readonly { traceId: string; spans: Span[]; occurredAtMs?: number }[];
    },
  ): Promise<Span[][]> {
    const { logRecords, traceCanonicalisation, logger } = this.#dependencies;
    const joinable = traces.filter(({ spans }) => hasCodingAgentJoinableSpans(spans));
    if (joinable.length === 0) return traces.map(({ spans }) => spans);

    let logsByTrace: Awaited<ReturnType<TraceLogRecordBatchReader["getLogsByTraceIds"]>>;
    try {
      logsByTrace = await logRecords.getLogsByTraceIds({
        tenantId,
        traces: joinable.map(({ traceId, occurredAtMs }) => ({ traceId, occurredAtMs })),
      });
    } catch (error) {
      logger?.warn(
        {
          tenantId,
          traceCount: joinable.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Claude Code log enrichment skipped: failed to read the batch's trace logs",
      );
      return traces.map(({ spans }) =>
        hasCodingAgentJoinableSpans(spans) ? enrichClaudeInteractionInputs(spans) : spans,
      );
    }

    return traces.map(({ traceId, spans }) =>
      hasCodingAgentJoinableSpans(spans)
        ? enrichSpansWithClaudeLogContent({
            spans,
            logRows: [...(logsByTrace.get(traceId) ?? [])],
            traceCanonicalisation,
          })
        : spans,
    );
  }
}
