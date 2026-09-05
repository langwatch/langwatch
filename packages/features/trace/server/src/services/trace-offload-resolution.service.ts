/**
 * Read-time recompute of offloaded trace event refs (ADR-022). When `release_trace_blob_offload` is on at ingestion, the live pipeline writes the FULL event to event_log and dispatches a leaned shape to projections — `leanForProjection` rewrites over-threshold IO values to a bounded preview with a `langwatch.reserved.eventref.<attrKey>` pointer, so the fold writes a preview-based computedInput/computedOutput. On the **read path** this restores full values: extract eventref pointers, fetch full bytes via TraceBlobStoreService.getFromEventLog, replace spanAttributes with the resolved map, and re-run TraceIOExtractionService when any span resolved so trace.input/output reflect full content. Error policy: a missing event_log row must NOT break the read — log at warn and keep the preview, marked via anyResolved=false.
 */
import { TraceEventRefParsingService } from "./trace-eventref-parsing.service";
import type { Logger as PinoLogger } from "@langwatch/observability";
import type { TraceBlobStoreService } from "./trace-blob-store.service";
import { BlobFieldNotFoundError, BlobNotFoundError } from "./trace-blob-store.service";
import type { ExtractedIO, TraceIOExtractionService } from "#services/trace-io-extraction.service";
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
   * Resolves offloaded event refs for a single trace's normalized spans: for each span carrying `langwatch.reserved.eventref.*`, fetches full bytes (getFromEventLog), replaces spanAttributes with the resolved map, and re-runs TraceIOExtractionService when any span resolved. A missing event_log row leaves that span unchanged (preview intact) and is logged at warn, never propagated — a stale ref must not break trace listing.
   * @param projectId/normalizedSpans/blobStore/ioExtractionService - Tenant, per-trace spans, blob store, and IO recomputation (each span's eventId comes from its own embedded pointer; spans without eventrefs pass through unchanged).
   * @param aggregateType/logger - event_log aggregate type (default "trace") and logger for missing-ref warnings.
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
    // Fast path: no span in this trace has any event ref — skip entirely.
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

    // Resolve each span individually so a failure on one span does not block
    // the others. Promise.allSettled ensures successfully resolved spans are
    // returned even when a span's resolver throws an unexpected uncaught error.
    const spanSettlements = await Promise.allSettled(
      normalizedSpans.map(async (span) => {
        const attrs = span.spanAttributes;
        if (!TraceEventRefParsingService.hasEventRefs(attrs)) {
          return { span, resolvedCount: 0 };
        }

        // Separate eventref keys from regular attributes (shared decoder).
        const { cleanedAttrs, eventrefEntries, missingEventIdKeys } =
          TraceEventRefParsingService.parseSpanEventRefs(attrs);

        // Eventref missing the embedded eventId can't resolve. The reserved
        // key is already stripped (kept out of cleanedAttrs) so the UI never
        // sees the namespace; the preview under the plain IO key stays in place.
        for (const attrKey of missingEventIdKeys) {
          logger.warn(
            {
              projectId,
              spanId: span.spanId,
              traceId: span.traceId,
              attrKey,
            },
            "eventref missing eventId — keeping preview value",
          );
        }

        if (eventrefEntries.length === 0) {
          // All ref keys were malformed JSON or missing eventId — strip
          // reserved keys anyway so the UI never sees the namespace.
          return {
            span: { ...span, spanAttributes: cleanedAttrs },
            resolvedCount: 0,
          };
        }

        // ADR-022: aggregateId for the trace-processing pipeline IS the traceId.
        // The eventref carries the eventId, written by leanForProjection from
        // event.id at lean time — see lean-for-projection.ts:120.
        const aggregateId = span.traceId;

        const resolvedAttrs = { ...cleanedAttrs };

        // Parallelize independent event_log fetches for each eventref in this span.
        const fieldResults = await Promise.allSettled(
          eventrefEntries.map(async ({ attrKey, field, eventId }) => {
            const fullValue = await blobStore.getFromEventLog({
              eventId,
              field,
              tenantId: projectId,
              aggregateType,
              aggregateId,
            });

            return { attrKey, fullValue };
          }),
        );

        let resolvedCount = 0;
        for (const [idx, result] of fieldResults.entries()) {
          if (result.status === "fulfilled") {
            resolvedAttrs[result.value.attrKey] = result.value.fullValue;
            resolvedCount++;
          } else {
            // Log and keep preview for this field; other fields are not affected.
            const err = result.reason;
            const attrKey = eventrefEntries[idx]?.attrKey ?? "unknown";
            if (err instanceof BlobNotFoundError || err instanceof BlobFieldNotFoundError) {
              logger.warn(
                {
                  projectId,
                  spanId: span.spanId,
                  traceId: span.traceId,
                  attrKey,
                  error: (err as Error).message,
                },
                "event_log row not found for eventref — keeping preview value",
              );
            } else {
              logger.warn(
                {
                  projectId,
                  spanId: span.spanId,
                  traceId: span.traceId,
                  attrKey,
                  error: err instanceof Error ? err.message : String(err),
                },
                "Failed to resolve eventref from event_log — keeping preview value",
              );
            }
          }
        }

        return {
          span: { ...span, spanAttributes: resolvedAttrs },
          resolvedCount,
        };
      }),
    );

    // Collect resolved spans; fall back to original span on unexpected rejection.
    let anyResolved = false;
    const resolvedSpans: NormalizedSpan[] = spanSettlements.map((settlement, i) => {
      if (settlement.status === "fulfilled") {
        if (settlement.value.resolvedCount > 0) {
          anyResolved = true;
        }

        return settlement.value.span;
      }

      // Unexpected uncaught error from the span's async mapper — log and fall back.
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

    // At least one span was resolved — recompute trace-level IO from the full
    // span values.
    const recomputedInput = ioExtractionService.extractFirstInput(resolvedSpans);
    const recomputedOutput = ioExtractionService.extractLastOutput(resolvedSpans);

    return {
      resolvedSpans,
      recomputedInput,
      recomputedOutput,
      anyResolved: true,
    };
  }
}
