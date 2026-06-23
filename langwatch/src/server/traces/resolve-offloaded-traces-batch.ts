/**
 * Bulk read-path resolution of offloaded trace event refs (ADR-022, #4991).
 *
 * The per-trace {@link ./resolve-offloaded-traces#resolveOffloadedTraces} is the
 * right tool for a single-trace detail read (#4984). The BULK consumers —
 * export, thread, annotation queue, dataset/sample builders — read whole result
 * sets, where resolving each trace independently would fan out an unbounded
 * N×M burst of `event_log` SELECTs (one per offloaded field × every row),
 * exhausting the ClickHouse connection pool on a large export.
 *
 * This module resolves a WHOLE result set in one pass:
 *   1. Decode the eventref pointers off every span across every trace.
 *   2. Dedupe identical `(aggregateId, eventId, field)` refs to one fetch.
 *   3. Stream the `event_log` reads through a bounded-concurrency pool — peak
 *      in-flight CH reads is a CONSTANT regardless of result-set size (AC6).
 *   4. Scatter the resolved full values back onto each span, strip the reserved
 *      eventref keys, and recompute trace-level IO per trace.
 *
 * Error policy (AC7): a missing/failed event_log row must NOT break the read —
 * the affected field keeps its preview and a warning is logged; every other
 * field and trace still resolves.
 */
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import {
  BlobFieldNotFoundError,
  BlobNotFoundError,
} from "~/server/app-layer/traces/blob-store.service";
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  hasEventRefs,
  parseSpanEventRefs,
} from "./offloaded-eventref-parsing";
import type { ResolvedTraceSpans, WarnLogger } from "./resolve-offloaded-traces";

/**
 * Maximum number of concurrent `event_log` reads in flight at once across an
 * entire result set. Bounds the bulk read path's load on ClickHouse so a large
 * export/thread streams its blob fetches instead of firing all of them at once
 * (#4991 AC6). Sized to keep the CH client's connection pool busy without
 * saturating it.
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
  cleanedAttrs: Record<string, string>;
  /** Which fetch key fills which attribute key. */
  refs: Array<{ attrKey: string; fetchKey: string }>;
  /** False when the span had no eventrefs (returned untouched). */
  hadRefs: boolean;
}

/** Internal: outcome of a single event_log fetch. */
type FetchResult =
  | { ok: true; value: string }
  | { ok: false; error: unknown };

/** Builds the dedup key for a fetch task. NUL separator can't collide with ids. */
function fetchKeyOf(aggregateId: string, eventId: string, field: string): string {
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
  if (
    error instanceof BlobNotFoundError ||
    error instanceof BlobFieldNotFoundError
  ) {
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

/**
 * Resolves offloaded event refs for a whole result set of traces in one bounded
 * pass. See the module doc for the algorithm and error policy.
 *
 * @param projectId - The tenantId / projectId all traces belong to.
 * @param spansPerTrace - The NormalizedSpan array for each trace, in result order.
 * @param blobStore - BlobStore providing getFromEventLog.
 * @param ioExtractionService - Recomputes trace-level IO from resolved spans.
 * @param logger - Logger for resolution-failure warnings.
 * @param aggregateType - Aggregate type for event_log lookup (default: "trace").
 * @param concurrency - Max concurrent event_log reads (default {@link EVENT_LOG_RESOLVE_CONCURRENCY}).
 * @returns One {@link ResolvedTraceSpans} per input trace, aligned to input order.
 */
export async function resolveOffloadedTracesBatch({
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
  blobStore: BlobStore;
  ioExtractionService: TraceIOExtractionService;
  logger: WarnLogger;
  aggregateType?: string;
  concurrency?: number;
}): Promise<ResolvedTraceSpans[]> {
  // ----- Phase 1: parse every span, build per-span plans + a deduped fetch map.
  const fetchTasks = new Map<string, FetchTask>();
  const tracePlans: SpanPlan[][] = spansPerTrace.map((spans) =>
    spans.map((span) => {
      const attrs = span.spanAttributes as Record<string, string>;
      if (!hasEventRefs(attrs)) {
        return { cleanedAttrs: attrs, refs: [], hadRefs: false };
      }

      const { cleanedAttrs, eventrefEntries, missingEventIdKeys } =
        parseSpanEventRefs(attrs);

      for (const attrKey of missingEventIdKeys) {
        logger.warn(
          { projectId, spanId: span.spanId, traceId: span.traceId, attrKey },
          "eventref missing eventId — keeping preview value",
        );
      }

      // ADR-022: aggregateId for the trace-processing pipeline IS the traceId.
      const aggregateId = span.traceId;
      const refs = eventrefEntries.map(({ attrKey, field, eventId }) => {
        const fetchKey = fetchKeyOf(aggregateId, eventId, field);
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
