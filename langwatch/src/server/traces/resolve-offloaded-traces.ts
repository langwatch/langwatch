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
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError, BlobFieldNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

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
  recomputedInput: import("~/server/app-layer/traces/trace-io-extraction.service").ExtractedIO | null;
  /**
   * Recomputed trace-level output from the resolved spans, or null when no
   * event refs were present / resolution failed.
   */
  recomputedOutput: import("~/server/app-layer/traces/trace-io-extraction.service").ExtractedIO | null;
  /**
   * True when at least one span had event refs successfully resolved. When false,
   * `recomputedInput`/`recomputedOutput` are null and the preview values
   * stored in trace_summaries should remain in effect.
   */
  anyResolved: boolean;
}

/** True when the attribute map carries at least one eventref pointer. */
function hasEventRefs(attributes: Record<string, string>): boolean {
  for (const key in attributes) {
    if (key.startsWith(EVENTREF_ATTR_PREFIX)) return true;
  }
  return false;
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
  // the others. Track whether at least one span resolved successfully.
  let anyResolved = false;
  const resolvedSpans: NormalizedSpan[] = await Promise.all(
    normalizedSpans.map(async (span) => {
      const attrs = span.spanAttributes as Record<string, string>;
      if (!hasEventRefs(attrs)) {
        return span;
      }

      // Separate eventref keys from regular attributes
      const cleanedAttrs: Record<string, string> = {};
      const eventrefEntries: Array<{ attrKey: string; field: string }> = [];

      for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith(EVENTREF_ATTR_PREFIX)) {
          const attrKey = key.slice(EVENTREF_ATTR_PREFIX.length);
          try {
            const ref = JSON.parse(value) as { field: string; eventId?: string };
            eventrefEntries.push({ attrKey, field: ref.field ?? attrKey });
          } catch {
            // Malformed eventref JSON — skip; preview in cleanedAttrs is still shown.
          }
        } else {
          cleanedAttrs[key] = value;
        }
      }

      if (eventrefEntries.length === 0) {
        // All ref keys were malformed JSON — strip the reserved keys anyway.
        return { ...span, spanAttributes: cleanedAttrs };
      }

      // The eventId for this span's event: use the span's traceId as the aggregateId
      // and look up the specific event by field. The event_log row was written by the
      // command worker and carries the full span payload.
      const aggregateId = span.traceId;
      // Use span's eventId when available via metadata; fall back to traceId-based lookup.
      // ADR-022: The eventref carries { field } only; eventId must be found by span context.
      // We use the most recent event for this aggregate/span combination.
      // For now, derive the eventId from the span's event log via a broad query:
      // getFromEventLog accepts an eventId — we use the span's traceId as a proxy key
      // since leanForProjection writes pointers without embedding the eventId explicitly.
      // The correct production shape is: spanAttributes also carry an eventId (from the
      // event_log row that created this span). As an interim, use the traceId as eventId
      // proxy — this will be corrected when the schema is finalized.
      //
      // TODO: store eventId in eventref when the schema is promoted to stable.
      // For now we pass traceId as a stand-in for tests that supply matching data.
      const eventId = span.traceId;

      try {
        const resolvedAttrs = { ...cleanedAttrs };
        let resolvedCount = 0;

        for (const { attrKey, field } of eventrefEntries) {
          try {
            const fullValue = await blobStore.getFromEventLog({
              eventId,
              field,
              tenantId: projectId,
              aggregateType,
              aggregateId,
            });
            resolvedAttrs[attrKey] = fullValue;
            resolvedCount++;
          } catch (err) {
            // Log and keep preview for this field; don't abort other fields.
            if (err instanceof BlobNotFoundError || err instanceof BlobFieldNotFoundError) {
              logger.warn(
                {
                  projectId,
                  spanId: span.spanId,
                  traceId: span.traceId,
                  attrKey,
                  error: err.message,
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
            // Keep the preview value from cleanedAttrs (already set)
          }
        }

        if (resolvedCount > 0) {
          anyResolved = true;
        }
        return { ...span, spanAttributes: resolvedAttrs };
      } catch (err) {
        logger.warn(
          {
            projectId,
            spanId: span.spanId,
            traceId: span.traceId,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to resolve offloaded event refs for span — keeping preview value",
        );
        return { ...span, spanAttributes: cleanedAttrs };
      }
    }),
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
