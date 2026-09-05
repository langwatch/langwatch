/**
 * Bulk read-path resolution of offloaded trace event refs (ADR-022, #4991). The per-trace resolver is right for a single-trace detail read (#4984); BULK consumers (export, thread, annotation queue, dataset/sample builders) read whole result sets, where resolving each trace independently would fan out an unbounded N×M burst of `event_log` SELECTs, exhausting the ClickHouse connection pool. This module instead: decodes eventref pointers off every span across every trace, dedupes identical `(aggregateId, eventId, field)` refs to one fetch, streams reads through a bounded-concurrency pool (constant peak in-flight CH reads regardless of result-set size, AC6), then scatters resolved values back and recomputes trace-level IO. Error policy (AC7): a missing/failed row must NOT break the read — the affected field keeps its preview and logs a warning, every other field and trace still resolves.
 */
import { TraceEventRefParsingService } from "./trace-eventref-parsing.service";
import type { TraceBlobStoreService } from "./trace-blob-store.service";
import { BlobFieldNotFoundError, BlobNotFoundError } from "./trace-blob-store.service";
import type { TraceIOExtractionService } from "#services/trace-io-extraction.service";
import type { NormalizedAttributes, NormalizedSpan } from "@langwatch/trace-contract";
import type { ResolvedTraceSpans, WarnLogger } from "./trace-offload-resolution.service";

/**
 * Maximum concurrent `event_log` reads in flight across an entire result set. Bounds the bulk read path's load on ClickHouse so a large export/thread streams its blob fetches instead of firing all at once (#4991 AC6), sized to keep the CH client's connection pool busy without saturating it.
 */
export const EVENT_LOG_RESOLVE_CONCURRENCY = 25;

/** Internal: a single deduped event_log fetch task. */
interface FetchTask {
  eventId: string;
  field: string;
  aggregateId: string;
}

/** Internal: per-span plan built in the parse phase. */
interface SpanPlan {
  /** Preview/regular attributes with reserved keys removed. */
  cleanedAttrs: NormalizedAttributes;
  /** Which fetch key fills which attribute key. */
  refs: Array<{ attrKey: string; fetchKey: string }>;
  /** False when the span had no eventrefs (returned untouched). */
  hadRefs: boolean;
}

/** Internal: outcome of a single event_log fetch. */
type FetchResult = { ok: true; value: string } | { ok: false; error: unknown };

/**
 * Builds the dedup key for a fetch task (NUL separator can't collide with ids). Named params, not positional: all three args are plain strings, so a caller that transposed two would compile cleanly and silently dedupe/fetch the wrong event_log row onto the wrong span.
 */
function fetchKeyOf({
  aggregateId,
  eventId,
  field,
}: {
  aggregateId: string;
  eventId: string;
  field: string;
}): string {
  return `${aggregateId}\u0000${eventId}\u0000${field}`;
}

/**
 * Runs `fn` over `items` with at most `concurrency` promises in flight, awaiting
 * all of them. Order of execution is unconstrained; callers collect results via
 * side effects (the resolver writes into a shared Map keyed by fetch key).
 */
async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

/** Logs a per-field resolution failure at warn level (no silent truncation). */
function warnResolutionFailure(
  logger: WarnLogger,
  projectId: string,
  span: NormalizedSpan,
  attrKey: string,
  error: unknown,
): void {
  if (error instanceof BlobNotFoundError || error instanceof BlobFieldNotFoundError) {
    logger.warn(
      {
        projectId,
        spanId: span.spanId,
        traceId: span.traceId,
        attrKey,
        error: (error as Error).message,
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
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to resolve eventref from event_log — keeping preview value",
    );
  }
}

export class TraceOffloadResolutionBatchService {
  static create(): TraceOffloadResolutionBatchService {
    return new TraceOffloadResolutionBatchService();
  }

  /**
   * @param projectId/spansPerTrace/blobStore/ioExtractionService/logger - Tenant, per-trace NormalizedSpan arrays (result order), blob store, IO recomputation, and warning logger. Resolves refs for a whole result set in one bounded pass — see module doc.
   * @param aggregateType/concurrency - event_log aggregate type (default "trace") and max concurrent reads (default {@link EVENT_LOG_RESOLVE_CONCURRENCY}).
   * @returns One {@link ResolvedTraceSpans} per input trace, aligned to input order.
   */
  static async resolveOffloadedTracesBatch({
    projectId,
    spansPerTrace,
    blobStore,
    ioExtractionService,
    logger,
    aggregateType = "trace",
    concurrency = EVENT_LOG_RESOLVE_CONCURRENCY,
  }: {
    projectId: string;
    spansPerTrace: NormalizedSpan[][];
    blobStore: TraceBlobStoreService;
    ioExtractionService: TraceIOExtractionService;
    logger: WarnLogger;
    aggregateType?: string;
    concurrency?: number;
  }): Promise<ResolvedTraceSpans[]> {
    // ----- Phase 1: parse every span, build per-span plans + a deduped fetch map.
    const fetchTasks = new Map<string, FetchTask>();
    const tracePlans: SpanPlan[][] = spansPerTrace.map((spans) =>
      spans.map((span) => {
        const attrs = span.spanAttributes;
        if (!TraceEventRefParsingService.hasEventRefs(attrs)) {
          return { cleanedAttrs: attrs, refs: [], hadRefs: false };
        }

        const { cleanedAttrs, eventrefEntries, missingEventIdKeys } =
          TraceEventRefParsingService.parseSpanEventRefs(attrs);

        for (const attrKey of missingEventIdKeys) {
          logger.warn(
            { projectId, spanId: span.spanId, traceId: span.traceId, attrKey },
            "eventref missing eventId — keeping preview value",
          );
        }

        // ADR-022: aggregateId for the trace-processing pipeline IS the traceId.
        const aggregateId = span.traceId;
        const refs = eventrefEntries.map(({ attrKey, field, eventId }) => {
          const fetchKey = fetchKeyOf({ aggregateId, eventId, field });
          if (!fetchTasks.has(fetchKey)) {
            fetchTasks.set(fetchKey, { eventId, field, aggregateId });
          }

          return { attrKey, fetchKey };
        });

        return { cleanedAttrs, refs, hadRefs: true };
      }),
    );

    // ----- Phase 2: fetch each distinct ref once, bounded concurrency.
    const fetchResults = new Map<string, FetchResult>();
    await forEachWithConcurrency(
      [...fetchTasks.entries()],
      concurrency,
      async ([fetchKey, task]) => {
        try {
          const value = await blobStore.getFromEventLog({
            eventId: task.eventId,
            field: task.field,
            tenantId: projectId,
            aggregateType,
            aggregateId: task.aggregateId,
          });
          fetchResults.set(fetchKey, { ok: true, value });
        } catch (error) {
          fetchResults.set(fetchKey, { ok: false, error });
        }
      },
    );

    // ----- Phase 3: assemble resolved spans + recompute IO per trace.
    return tracePlans.map((spanPlans, traceIdx) => {
      const originalSpans = spansPerTrace[traceIdx]!;
      let anyResolved = false;

      const resolvedSpans: NormalizedSpan[] = spanPlans.map((plan, spanIdx) => {
        const span = originalSpans[spanIdx]!;
        if (!plan.hadRefs) {
          return span;
        }

        const resolvedAttrs = { ...plan.cleanedAttrs };
        for (const { attrKey, fetchKey } of plan.refs) {
          const result = fetchResults.get(fetchKey);
          if (result?.ok) {
            resolvedAttrs[attrKey] = result.value;
            anyResolved = true;
          } else if (result && !result.ok) {
            warnResolutionFailure(logger, projectId, span, attrKey, result.error);
          }
        }

        return { ...span, spanAttributes: resolvedAttrs };
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
        recomputedInput: ioExtractionService.extractFirstInput(resolvedSpans),
        recomputedOutput: ioExtractionService.extractLastOutput(resolvedSpans),
        anyResolved: true,
      };
    });
  }
}
