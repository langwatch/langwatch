/**
 * Read-time recompute of offloaded trace event refs (ADR-022). Ingestion writes the full event to
 * event_log and leans projections, so the fold holds preview IO; the read path resolves the
 * pointers and re-runs IO extraction. A missing row logs at warn and keeps the preview.
 */
import { TraceEventRefParsingService } from "./trace-eventref-parsing.service";
import type { Logger as PinoLogger } from "@langwatch/observability";
import type { TraceBlobStoreService } from "./trace-blob-store.service";
import { BlobFieldNotFoundError, BlobNotFoundError } from "./trace-blob-store.service";
import type { TraceIOExtractionService } from "#services/trace-io-extraction.service";
import type { ExtractedIO } from "#rules/trace-io-text.rules";
import type { NormalizedSpan } from "@langwatch/trace-contract";

/** Minimal logger interface required by this module (subset of PinoLogger). */
export type WarnLogger = Pick<PinoLogger, "warn" | "error">;

/**
 * Result of resolving offloaded blobs for a single trace's spans.
 */
export interface ResolvedTraceSpans {
  /** Spans with full attribute values restored (refs stripped). */
  resolvedSpans: NormalizedSpan[];
  /**
   * Recomputed trace-level input from the resolved spans, or null when no
   * event refs were present / resolution failed.
   */
  recomputedInput: ExtractedIO | null;
  /**
   * Recomputed trace-level output from the resolved spans, or null when no
   * event refs were present / resolution failed.
   */
  recomputedOutput: ExtractedIO | null;
  /**
   * True when at least one span had event refs successfully resolved. When false,
   * `recomputedInput`/`recomputedOutput` are null and the preview values
   * stored in trace_summaries should remain in effect.
   */
  anyResolved: boolean;
}

export class TraceOffloadResolutionService {
  static create(): TraceOffloadResolutionService {
    return new TraceOffloadResolutionService();
  }

  /**
   * Resolves offloaded event refs for one trace's normalized spans, replacing spanAttributes with
   * the resolved map and re-running IO extraction when any span resolved. A missing event_log row
   * leaves that span's preview intact and is logged at warn, never propagated.
   */
  static async resolveOffloadedTraces({
    projectId,
    normalizedSpans,
    blobStore,
    ioExtractionService,
    logger,
    aggregateType = "trace",
  }: {
    projectId: string;
    normalizedSpans: NormalizedSpan[];
    blobStore: TraceBlobStoreService;
    ioExtractionService: TraceIOExtractionService;
    logger: WarnLogger;
    aggregateType?: string;
  }): Promise<ResolvedTraceSpans> {
    // Fast path: no span in this trace has any event ref, so there is nothing to resolve.
    const anyHasRefs = normalizedSpans.some((span) =>
      TraceEventRefParsingService.hasEventRefs(span.spanAttributes),
    );
    if (!anyHasRefs) {
      return {
        resolvedSpans: normalizedSpans,
        recomputedInput: null,
        recomputedOutput: null,
        anyResolved: false,
      };
    }

    // Each span resolves on its own so one failing does not block the others, and settlements
    // keep the successes even when a span's resolver throws something unexpected.
    const spanSettlements = await Promise.allSettled(
      normalizedSpans.map((span) =>
        TraceOffloadResolutionService.resolveSpan({
          span,
          projectId,
          blobStore,
          logger,
          aggregateType,
        }),
      ),
    );

    let anyResolved = false;
    const resolvedSpans: NormalizedSpan[] = spanSettlements.map((settlement, i) => {
      if (settlement.status === "fulfilled") {
        if (settlement.value.resolvedCount > 0) {
          anyResolved = true;
        }

        return settlement.value.span;
      }

      logger.warn(
        {
          projectId,
          spanId: normalizedSpans[i]?.spanId,
          traceId: normalizedSpans[i]?.traceId,
          error:
            settlement.reason instanceof Error
              ? settlement.reason.message
              : String(settlement.reason),
        },
        "Failed to resolve offloaded event refs for span — keeping preview value",
      );

      return normalizedSpans[i]!;
    });

    if (!anyResolved) {
      return {
        resolvedSpans,
        recomputedInput: null,
        recomputedOutput: null,
        anyResolved: false,
      };
    }

    return {
      resolvedSpans,
      recomputedInput: ioExtractionService.tryExtractFirstInput(resolvedSpans),
      recomputedOutput: ioExtractionService.tryExtractLastOutput(resolvedSpans),
      anyResolved: true,
    };
  }

  /**
   * One span's attributes with its offloaded fields fetched back. Reserved keys are stripped
   * whatever happens, so the namespace never reaches the UI, and a field that cannot be fetched
   * keeps the preview already sitting under its plain IO key.
   */
  private static async resolveSpan({
    span,
    projectId,
    blobStore,
    logger,
    aggregateType,
  }: {
    span: NormalizedSpan;
    projectId: string;
    blobStore: TraceBlobStoreService;
    logger: WarnLogger;
    aggregateType: string;
  }): Promise<{ span: NormalizedSpan; resolvedCount: number }> {
    const attrs = span.spanAttributes;
    if (!TraceEventRefParsingService.hasEventRefs(attrs)) {
      return { span, resolvedCount: 0 };
    }

    const { cleanedAttrs, eventrefEntries, missingEventIdKeys } =
      TraceEventRefParsingService.parseSpanEventRefs(attrs);
    for (const attrKey of missingEventIdKeys) {
      logger.warn(
        { projectId, spanId: span.spanId, traceId: span.traceId, attrKey },
        "eventref missing eventId — keeping preview value",
      );
    }

    if (eventrefEntries.length === 0) {
      return { span: { ...span, spanAttributes: cleanedAttrs }, resolvedCount: 0 };
    }

    // ADR-022: the aggregate id for the trace-processing pipeline is the traceId, and the
    // eventref carries the eventId the lean wrote at projection time.
    const resolvedAttrs = { ...cleanedAttrs };
    const fieldResults = await Promise.allSettled(
      eventrefEntries.map(async ({ attrKey, field, eventId }) => ({
        attrKey,
        fullValue: await blobStore.getFromEventLog({
          eventId,
          field,
          tenantId: projectId,
          aggregateType,
          aggregateId: span.traceId,
        }),
      })),
    );

    let resolvedCount = 0;
    for (const [idx, result] of fieldResults.entries()) {
      if (result.status === "fulfilled") {
        resolvedAttrs[result.value.attrKey] = result.value.fullValue;
        resolvedCount++;
        continue;
      }

      TraceOffloadResolutionService.warnFieldUnresolved({
        error: result.reason,
        projectId,
        span,
        attrKey: eventrefEntries[idx]?.attrKey ?? "unknown",
        logger,
      });
    }

    return { span: { ...span, spanAttributes: resolvedAttrs }, resolvedCount };
  }

  /** One field kept at its preview, said differently for a missing row than for a failed read. */
  private static warnFieldUnresolved({
    error,
    projectId,
    span,
    attrKey,
    logger,
  }: {
    error: unknown;
    projectId: string;
    span: NormalizedSpan;
    attrKey: string;
    logger: WarnLogger;
  }): void {
    const missing = error instanceof BlobNotFoundError || error instanceof BlobFieldNotFoundError;
    logger.warn(
      {
        projectId,
        spanId: span.spanId,
        traceId: span.traceId,
        attrKey,
        error: error instanceof Error ? error.message : String(error),
      },
      missing
        ? "event_log row not found for eventref — keeping preview value"
        : "Failed to resolve eventref from event_log — keeping preview value",
    );
  }
}
