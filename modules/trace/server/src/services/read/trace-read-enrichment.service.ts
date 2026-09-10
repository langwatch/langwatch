/**
 * The read-time tail every trace read shares: coding-agent content enrichment from the trace's log
 * records, then the reviewer's saved correction overlaid on top. Held apart from the read itself so
 * the read service stays a query surface and this stays the enrichment policy.
 */

import type { Protections, Trace, TraceCanonicalisationService } from "@langwatch/trace-contract";
import { applyOverlayToTrace } from "@langwatch/trace-contract";
import { createLogger } from "@langwatch/observability";

import {
  ClaudeCodeLogEnrichmentService,
  CODING_AGENT_ORIGIN,
  type TraceLogRecordReader,
} from "../canonicalisers/coding-agent/claude-code-log-enrichment.service.ts";
import { TraceEditOverlayRedactionService } from "../edit-overlay/trace-edit-overlay-redaction.service.ts";
import type { TraceEditOverlayService } from "../edit-overlay/trace-edit-overlay.service.ts";

export class TraceReadEnrichmentService {
  private readonly logger = createLogger("langwatch:traces:read-enrichment");

  private constructor(
    private readonly traceCanonicalisation: TraceCanonicalisationService,
    private readonly editOverlay: TraceEditOverlayService,
    private readonly injectedLogRecordStorage?: TraceLogRecordReader,
  ) {}

  static create({
    traceCanonicalisation,
    editOverlay,
    logRecordStorage,
  }: {
    traceCanonicalisation: TraceCanonicalisationService;
    editOverlay: TraceEditOverlayService;
    logRecordStorage?: TraceLogRecordReader;
  }): TraceReadEnrichmentService {
    return new TraceReadEnrichmentService(traceCanonicalisation, editOverlay, logRecordStorage);
  }

  /**
   * The log-record store for read-time Claude Code content enrichment.
   */
  private logRecordStorageService(): TraceLogRecordReader {
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
   * The single-trace tail shared by every branch of {@link tryGetById}: coding-agent
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
        patch: TraceEditOverlayRedactionService.redactPatchForViewer({
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
   * Batch sibling of {@link enrichCodingAgentTrace} for the multi-trace read paths, enriching each
   * coding-agent trace with its own lazy, time-capped log read a bounded few at a time. The
   * upfront origin check skips even the fan-out on an all-non-coding-agent page. Best-effort.
   */
  async enrichCodingAgentTraces(projectId: string, traces: Trace[]): Promise<Trace[]> {
    const hasCodingAgentTrace = traces.some(
      (trace) => trace.metadata?.["langwatch.origin"] === CODING_AGENT_ORIGIN,
    );
    if (!hasCodingAgentTrace) {
      return traces;
    }

    // Bounded fan-out: each enrichment holds a heavy log read (raw bodies run to 60 KB a row) in
    // memory, so an unbounded Promise.all over a big page multiplies that by the page size. Five
    // in flight keeps a bounded memory ceiling; non-coding-agent traces cost nothing.
    const enrichConcurrency = 5;
    const enriched: Trace[] = [...traces];
    for (let start = 0; start < traces.length; start += enrichConcurrency) {
      const chunk = traces.slice(start, start + enrichConcurrency);
      const results = await Promise.all(
        chunk.map((trace) => this.enrichCodingAgentTrace(projectId, trace)),
      );
      for (let offset = 0; offset < results.length; offset++) {
        enriched[start + offset] = results[offset]!;
      }
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

    const spans = await ClaudeCodeLogEnrichmentService.enrichCodingAgentSpansFromLogs({
      logRecords: this.logRecordStorageService(),
      tenantId: projectId,
      traceId: trace.trace_id,
      spans: trace.spans,
      occurredAtMs: trace.timestamps.started_at,
      logger: this.logger,
      traceCanonicalisation: this.traceCanonicalisation,
    });

    return spans === trace.spans ? trace : { ...trace, spans };
  }
}
