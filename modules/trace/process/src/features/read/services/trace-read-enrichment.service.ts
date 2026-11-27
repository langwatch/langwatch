/**
 * The read-time tail every trace read shares: coding-agent content enrichment from the trace's log
 * records, then the reviewer's saved correction overlaid on top. Held apart from the read itself so
 * the read service stays a query surface and this stays the enrichment policy.
 */

import { createLogger } from "@langwatch/observability";
import type { Protections, Trace, TraceCanonicalisationService } from "@langwatch/trace-contract";
import { applyOverlayToTrace } from "@langwatch/trace-contract";

import {
  CODING_AGENT_ORIGIN,
  type TraceLogRecordBatchReader,
  type TraceLogRecordReader,
} from "../../claude-code/rules/claude-code-log-enrichment.rules.ts";
import { ClaudeCodeLogEnrichmentService } from "../../claude-code/services/claude-code-log-enrichment.service.ts";
import { redactPatchForViewer } from "../../edit-overlay/rules/trace-edit-overlay-redaction.rules.ts";
import type { TraceEditOverlayService } from "../../edit-overlay/services/trace-edit-overlay.service.ts";

/**
 * Coding-agent traces per log read. Raw bodies run to 60 KB a row, so the batch bounds what one
 * read holds in memory; sequential batches keep one read per store in flight per page.
 */
const CODING_AGENT_LOG_READ_BATCH = 10;

export class TraceReadEnrichmentService {
  private readonly logger = createLogger("langwatch:traces:read-enrichment");

  private constructor(
    private readonly traceCanonicalisation: TraceCanonicalisationService,
    private readonly editOverlay: TraceEditOverlayService,
    private readonly injectedLogRecordStorage?: TraceLogRecordReader & TraceLogRecordBatchReader,
  ) {}

  static create({
    traceCanonicalisation,
    editOverlay,
    logRecordStorage,
  }: {
    traceCanonicalisation: TraceCanonicalisationService;
    editOverlay: TraceEditOverlayService;
    logRecordStorage?: TraceLogRecordReader & TraceLogRecordBatchReader;
  }): TraceReadEnrichmentService {
    return new TraceReadEnrichmentService(traceCanonicalisation, editOverlay, logRecordStorage);
  }

  /**
   * The log-record store for read-time Claude Code content enrichment.
   */
  private logRecordStorageService(): TraceLogRecordReader & TraceLogRecordBatchReader {
    const injected = this.injectedLogRecordStorage;
    if (!injected) {
      throw new Error(
        "This trace read was composed with no log-record reader, so a coding-agent trace cannot " +
          "be enriched with the content its spans left in the trace's log records.",
      );
    }

    return injected;
  }

  /**
   * The single-trace tail shared by every branch of {@link findById}: coding-agent
   * enrichment first, then the reviewer correction if the caller asked for one.
   */
  async enrichAndCorrect({
    projectId,
    trace,
    protections,
    withEditOverlay,
  }: {
    projectId: string;
    trace: Trace;
    protections: Protections;
    withEditOverlay?: boolean;
  }): Promise<Trace> {
    const enriched = await this.enrichCodingAgentTrace(projectId, trace);
    if (!withEditOverlay) {
      return enriched;
    }

    const [corrected] = await this.applyEditOverlays(projectId, [enriched], protections);

    return corrected ?? enriched;
  }

  /**
   * Overlays reviewer corrections onto a page of traces, in one read for the whole page. Runs
   * last on every opted-in path, after blob resolution and coding-agent enrichment, so a
   * correction wins over whatever the resolvers put in the field.
   */
  async applyEditOverlays(
    projectId: string,
    traces: Trace[],
    protections: Protections,
  ): Promise<Trace[]> {
    if (traces.length === 0) {
      return traces;
    }

    const patches = await this.editOverlay.getPatchesByTraceIds({
      projectId,
      traceIds: traces.map((trace) => trace.trace_id),
    });
    if (patches.size === 0) {
      return traces;
    }

    let changed = false;
    const corrected = traces.map((trace) => {
      const patch = patches.get(trace.trace_id);
      if (!patch) {
        return trace;
      }

      const next = applyOverlayToTrace({
        trace,
        patch: redactPatchForViewer({
          patch,
          protections,
          isWindowRedacted: trace.redacted_by_visibility_window === true,
        }),
      });
      if (next !== trace) {
        changed = true;
      }

      return next;
    });

    return changed ? corrected : traces;
  }

  /**
   * Batch sibling of {@link enrichCodingAgentTrace} for the multi-trace read paths: the
   * coding-agent traces are enriched a batch at a time, one log read per store per batch, so a
   * page of thousands of traces costs a few statements in flight rather than one per trace.
   */
  async enrichCodingAgentTraces(projectId: string, traces: Trace[]): Promise<Trace[]> {
    const codingAgent = traces.flatMap((trace, index) =>
      trace.metadata?.["langwatch.origin"] === CODING_AGENT_ORIGIN ? [{ trace, index }] : [],
    );
    if (codingAgent.length === 0) {
      return traces;
    }

    const enrichment = ClaudeCodeLogEnrichmentService.create({
      logRecords: this.logRecordStorageService(),
      logger: this.logger,
      traceCanonicalisation: this.traceCanonicalisation,
    });
    const enriched: Trace[] = [...traces];
    for (let start = 0; start < codingAgent.length; start += CODING_AGENT_LOG_READ_BATCH) {
      const batch = codingAgent.slice(start, start + CODING_AGENT_LOG_READ_BATCH);
      const spans = await enrichment.enrichManyCodingAgentSpansFromLogs({
        tenantId: projectId,
        traces: batch.map(({ trace }) => ({
          traceId: trace.trace_id,
          spans: trace.spans,
          occurredAtMs: trace.timestamps.started_at,
        })),
      });
      batch.forEach(({ trace, index }, offset) => {
        const traceSpans = spans[offset]!;
        enriched[index] = traceSpans === trace.spans ? trace : { ...trace, spans: traceSpans };
      });
    }

    return enriched;
  }

  /**
   * Read-time Claude Code content enrichment for coding-agent-origin traces. The `llm_request`
   * spans carry tokens but no message content and no cost — both live in the trace's log records —
   * so one lazy, time-capped read joins them onto the spans. Origin-gated and best-effort.
   */
  async enrichCodingAgentTrace(projectId: string, trace: Trace): Promise<Trace> {
    if (trace.metadata?.["langwatch.origin"] !== CODING_AGENT_ORIGIN) {
      return trace;
    }

    const spans = await ClaudeCodeLogEnrichmentService.create({
      logRecords: this.logRecordStorageService(),
      logger: this.logger,
      traceCanonicalisation: this.traceCanonicalisation,
    }).enrichCodingAgentSpansFromLogs({
      tenantId: projectId,
      traceId: trace.trace_id,
      spans: trace.spans,
      occurredAtMs: trace.timestamps.started_at,
    });

    return spans === trace.spans ? trace : { ...trace, spans };
  }
}
