/**
 * Read-time recompute of offloaded trace blob refs (ADR-021, decision B).
 *
 * When the `release_trace_blob_offload` flag is on at ingestion time, over-
 * threshold span field values are stored in S3 and replaced with a bounded
 * preview + a `langwatch.reserved.blobref.<attrKey>` reference inside
 * SpanAttributes. The fold therefore writes a preview-based computedInput/
 * computedOutput into trace_summaries.
 *
 * On the **read path** this module restores the full values:
 *   1. Extract blob refs from each span's SpanAttributes.
 *   2. Fetch the full bytes from S3 via SpanBlobResolutionService.
 *   3. Replace the span's SpanAttributes with the resolved (full-value) map.
 *   4. If any span was resolved, re-run TraceIOExtractionService over the
 *      resolved spans so trace.input / trace.output reflect the full content
 *      rather than the 2 KB preview stored in trace_summaries.
 *
 * Error policy: a missing blob (NoSuchKey) must NOT break the read — log at
 * warn level and keep the preview in place, marked via anyResolved=false on
 * the affected trace.
 */
import type { Logger as PinoLogger } from "pino";
import {
  extractBlobRefsFromAttributes,
  hasBlobRefs,
} from "~/server/app-layer/traces/blob-ref-attributes";
import { BlobIntegrityError, UnauthorizedBlobAccessError } from "~/server/app-layer/traces/blob-store.service";
import type { SpanBlobResolutionService } from "~/server/app-layer/traces/span-blob-resolution.service";
import type { ExtractedIO, TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
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
   * blob refs were present / resolution failed.
   */
  recomputedInput: ExtractedIO | null;
  /**
   * Recomputed trace-level output from the resolved spans, or null when no
   * blob refs were present / resolution failed.
   */
  recomputedOutput: ExtractedIO | null;
  /**
   * True when at least one span had blobs successfully resolved. When false,
   * `recomputedInput`/`recomputedOutput` are null and the preview values
   * stored in trace_summaries should remain in effect.
   */
  anyResolved: boolean;
}

/**
 * Resolves offloaded blob refs for a single trace's normalized spans.
 *
 * For each span that carries `langwatch.reserved.blobref.*` attributes:
 *   - Calls SpanBlobResolutionService to fetch the full bytes from S3.
 *   - Replaces the span's SpanAttributes with the resolved map (ref keys
 *     stripped; full values in place of previews).
 *   - If any span was resolved, re-runs TraceIOExtractionService over the
 *     resolved spans to produce a fresh recomputedInput / recomputedOutput.
 *
 * A missing blob (any error thrown by the blob store) causes the span to be
 * returned unchanged (preview intact). The error is logged at warn level; it
 * does NOT propagate — a stale blob must not break trace listing.
 *
 * @param projectId - The project whose S3 bucket is used for resolution.
 * @param normalizedSpans - The raw NormalizedSpan array for a single trace,
 *   as returned by fetchTracesWithSpansJoined before mapping to legacy Span.
 * @param blobResolutionService - Resolves blob refs back to their full values.
 * @param ioExtractionService - Recomputes trace-level IO from the resolved spans.
 * @param logger - Logger for missing-blob warnings.
 */
export async function resolveOffloadedTraces({
  projectId,
  normalizedSpans,
  blobResolutionService,
  ioExtractionService,
  logger,
}: {
  projectId: string;
  normalizedSpans: NormalizedSpan[];
  blobResolutionService: SpanBlobResolutionService;
  ioExtractionService: TraceIOExtractionService;
  logger: WarnLogger;
}): Promise<ResolvedTraceSpans> {
  // Fast path: no span in this trace has any blob ref — skip entirely.
  const anyHasRefs = normalizedSpans.some((span) =>
    hasBlobRefs(span.spanAttributes as Record<string, string>),
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
      if (!hasBlobRefs(span.spanAttributes as Record<string, string>)) {
        return span;
      }

      const { attributes: cleanedAttrs, blobRefs } =
        extractBlobRefsFromAttributes(
          span.spanAttributes as Record<string, string>,
        );

      if (Object.keys(blobRefs).length === 0) {
        // All ref keys were malformed JSON — strip the reserved keys anyway so
        // they never leak to clients, but keep the preview values intact. CR-4.
        return { ...span, spanAttributes: cleanedAttrs };
      }

      try {
        const resolvedAttrs = await blobResolutionService.resolve({
          projectId,
          attributes: cleanedAttrs,
          blobRefs,
        });

        anyResolved = true;
        return { ...span, spanAttributes: resolvedAttrs };
      } catch (err) {
        const logContext = {
          projectId,
          spanId: span.spanId,
          traceId: span.traceId,
          blobKeys: Object.values(blobRefs).map((r) => r.key),
          error: err instanceof Error ? err.message : String(err),
        };

        if (err instanceof BlobIntegrityError || err instanceof UnauthorizedBlobAccessError) {
          // SHA-256 mismatch or cross-project access attempt: log loudly so ops
          // and auditors see this; still return the preview rather than throwing
          // — a corrupt or unauthorized blob must not break trace reads.
          logger.error(
            logContext,
            err instanceof BlobIntegrityError
              ? "Blob integrity check failed for span — SHA-256 mismatch, keeping preview value"
              : "Unauthorized blob access attempt — forged blob-ref key, keeping preview value",
          );
        } else {
          // Missing blob (NoSuchKey) or transient S3 error — log at warn level.
          logger.warn(
            logContext,
            "Failed to resolve offloaded blob for span — keeping preview value",
          );
        }

        // Return the span with blob-ref keys stripped but preview values intact.
        // cleanedAttrs has the reserved keys removed; the preview value under
        // attrKey is still present (extractBlobRefsFromAttributes preserves it).
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
  // span values. This is the second call site of TraceIOExtractionService
  // (first is the fold); reuse, not duplication.
  const recomputedInput = ioExtractionService.extractFirstInput(resolvedSpans);
  const recomputedOutput = ioExtractionService.extractLastOutput(resolvedSpans);

  return {
    resolvedSpans,
    recomputedInput,
    recomputedOutput,
    anyResolved: true,
  };
}
