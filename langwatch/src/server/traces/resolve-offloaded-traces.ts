/**
 * Read-time recompute of offloaded trace event refs (ADR-022).
 *
 * When the `release_trace_blob_offload` flag is on at ingestion time, the
 * live pipeline writes the FULL event to event_log and dispatches a leaned
 * shape to projection handlers. `leanForProjection` rewrites over-threshold
 * IO attribute values to a bounded preview and attaches a
 * `langwatch.reserved.eventref.<attrKey>` pointer carrying `{ field: <attrKey> }`.
 * The fold therefore writes a preview-based computedInput/computedOutput into
 * trace_summaries.
 *
 * On the **read path** this module restores the full values:
 *   1. Extract eventref pointers from each span's spanAttributes.
 *   2. Fetch the full bytes from event_log via BlobStore.getFromEventLog.
 *   3. Replace the span's spanAttributes with the resolved (full-value) map.
 *   4. If any span was resolved, re-run TraceIOExtractionService over the
 *      resolved spans so trace.input / trace.output reflect the full content
 *      rather than the preview stored in trace_summaries.
 *
 * Error policy: a missing event_log row must NOT break the read — log at
 * warn level and keep the preview in place, marked via anyResolved=false on
 * the affected trace.
 */
import type { Logger as PinoLogger } from "pino";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import {
  BlobFieldNotFoundError,
  BlobNotFoundError,
} from "~/server/app-layer/traces/blob-store.service";
import type {
  ExtractedIO,
  TraceIOExtractionService,
} from "~/server/app-layer/traces/trace-io-extraction.service";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { hasEventRefs, parseSpanEventRefs } from "./offloaded-eventref-parsing";

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

/**
 * Resolves offloaded event refs for a single trace's normalized spans.
 *
 * For each span that carries `langwatch.reserved.eventref.*` attributes:
 *   - Calls BlobStore.getFromEventLog to fetch the full bytes from event_log.
 *   - Replaces the span's spanAttributes with the resolved map (ref keys
 *     stripped; full values in place of previews).
 *   - If any span was resolved, re-runs TraceIOExtractionService over the
 *     resolved spans to produce a fresh recomputedInput / recomputedOutput.
 *
 * A missing event_log row (any error thrown by getFromEventLog) causes the span
 * to be returned unchanged (preview intact). The error is logged at warn level;
 * it does NOT propagate — a stale ref must not break trace listing.
 *
 * @param projectId - The tenantId / projectId for this trace.
 * @param normalizedSpans - The raw NormalizedSpan array for a single trace.
 * @param blobStore - BlobStore providing getFromEventLog.
 * @param ioExtractionService - Recomputes trace-level IO from the resolved spans.
 * @param eventId - The event_log EventId for the event that produced these spans.
 *   Derived from span context. When not provided, eventref resolution is skipped.
 * @param aggregateType - Aggregate type for event_log lookup (default: "trace").
 * @param logger - Logger for missing-ref warnings.
 */
export async function resolveOffloadedTraces({
  projectId,
  normalizedSpans,
  blobStore,
  ioExtractionService,
  logger,
  aggregateType = "trace",
}: {
  projectId: string;
  normalizedSpans: NormalizedSpan[];
  blobStore: BlobStore;
  ioExtractionService: TraceIOExtractionService;
  logger: WarnLogger;
  aggregateType?: string;
}): Promise<ResolvedTraceSpans> {
  // Fast path: no span in this trace has any event ref — skip entirely.
  const anyHasRefs = normalizedSpans.some((span) =>
    hasEventRefs(span.spanAttributes as Record<string, string>),
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
      const attrs = span.spanAttributes as Record<string, string>;
      if (!hasEventRefs(attrs)) {
        return { span, resolvedCount: 0 };
      }

      // Separate eventref keys from regular attributes (shared decoder).
      const { cleanedAttrs, eventrefEntries, missingEventIdKeys } =
        parseSpanEventRefs(attrs);

      // Eventref missing the embedded eventId — can't resolve. The reserved
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
          if (
            err instanceof BlobNotFoundError ||
            err instanceof BlobFieldNotFoundError
          ) {
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
  const resolvedSpans: NormalizedSpan[] = spanSettlements.map(
    (settlement, i) => {
      if (settlement.status === "fulfilled") {
        if (settlement.value.resolvedCount > 0) anyResolved = true;
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
    },
  );

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
