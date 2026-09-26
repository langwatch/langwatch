import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { Logger } from "@langwatch/observability";
import type { Span, TraceCanonicalisationService } from "@langwatch/trace-contract";

import {
  enrichClaudeInteractionInputs,
  enrichSpansWithClaudeLogContent,
  hasCodingAgentJoinableSpans,
  type TraceLogRecordReader,
} from "../rules/claude-code-log-enrichment.rules.ts";

export type ClaudeCodeLogEnrichmentDependencies = {
  logRecords: TraceLogRecordReader;
  traceCanonicalisation: TraceCanonicalisationService;
  codingAgents?: CodingAgentApi;
  logger?: Logger;
};

/** Joins Claude Code log content onto a trace's spans, reading the trace's logs once. */
export class ClaudeCodeLogEnrichmentService {
  readonly #dependencies: ClaudeCodeLogEnrichmentDependencies;

  static create(dependencies: ClaudeCodeLogEnrichmentDependencies): ClaudeCodeLogEnrichmentService {
    return new ClaudeCodeLogEnrichmentService(dependencies);
  }

  private constructor(dependencies: ClaudeCodeLogEnrichmentDependencies) {
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
    const { logRecords, traceCanonicalisation, codingAgents, logger } = this.#dependencies;

    try {
      const logRows = await logRecords.getLogsByTraceId({ tenantId, traceId, occurredAtMs });

      return enrichSpansWithClaudeLogContent({
        spans,
        logRows,
        traceCanonicalisation,
        codingAgents,
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
}
