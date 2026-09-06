/**
 * Bulk read-path resolution of offloaded trace event refs (ADR-022). Resolving each trace of a
 * result set independently fans out an unbounded burst of `event_log` SELECTs, so this dedupes
 * identical refs to one fetch and streams the reads through a bounded pool; a failure warns.
 */
import { TraceEventRefParsingService } from "./trace-eventref-parsing.service.ts";
import type { TraceBlobStoreService } from "./trace-blob-store.service.ts";
import { BlobFieldNotFoundError, BlobNotFoundError } from "./trace-blob-store.service.ts";
import type { TraceIOExtractionService } from "#services/trace-io-extraction.service";
import type { NormalizedAttributes, NormalizedSpan } from "@langwatch/trace-contract";
import type { ResolvedTraceSpans, WarnLogger } from "./trace-offload-resolution.service.ts";

/**
 * Maximum concurrent `event_log` reads in flight across an entire result set. It bounds the bulk
 * read path's load on ClickHouse so a large export or thread streams its blob fetches, sized to
 * keep the client's connection pool busy without saturating it.
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
 * Builds the dedup key for a fetch task; the NUL separator cannot collide with ids. Named rather
 * than positional parameters because all three are plain strings, so a caller that transposed two
 * would compile cleanly and fetch the wrong event_log row onto the wrong span.
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
   * Resolves refs for a whole result set in one bounded pass; see the module doc. Takes the tenant,
   * per-trace span arrays in result order, the blob store, IO recomputation and a warning logger,
   * plus the aggregate type and read concurrency. Returns one entry per trace, in input order.
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
    const fetchTasks = new Map<string, FetchTask>();
    const tracePlans: SpanPlan[][] = spansPerTrace.map((spans) =>
      spans.map((span) => planSpan({ span, projectId, logger, fetchTasks })),
    );

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

    return tracePlans.map((spanPlans, traceIdx) =>
      assembleTrace({
        spanPlans,
        originalSpans: spansPerTrace[traceIdx]!,
        fetchResults,
        ioExtractionService,
        logger,
        projectId,
      }),
    );
  }
}

/**
 * One span's plan: the attributes with reserved keys stripped, and the fetches its eventrefs need.
 * Identical fetches across every span of every trace collapse onto one entry in `fetchTasks`.
 */
function planSpan({
  span,
  projectId,
  logger,
  fetchTasks,
}: {
  span: NormalizedSpan;
  projectId: string;
  logger: WarnLogger;
  fetchTasks: Map<string, FetchTask>;
}): SpanPlan {
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

  // ADR-022: the aggregate id for the trace-processing pipeline is the traceId.
  const aggregateId = span.traceId;
  const refs = eventrefEntries.map(({ attrKey, field, eventId }) => {
    const fetchKey = fetchKeyOf({ aggregateId, eventId, field });
    if (!fetchTasks.has(fetchKey)) {
      fetchTasks.set(fetchKey, { eventId, field, aggregateId });
    }

    return { attrKey, fetchKey };
  });

  return { cleanedAttrs, refs, hadRefs: true };
}

/** One trace's spans with fetched values scattered back, and its IO recomputed if any landed. */
function assembleTrace({
  spanPlans,
  originalSpans,
  fetchResults,
  ioExtractionService,
  logger,
  projectId,
}: {
  spanPlans: SpanPlan[];
  originalSpans: NormalizedSpan[];
  fetchResults: Map<string, FetchResult>;
  ioExtractionService: TraceIOExtractionService;
  logger: WarnLogger;
  projectId: string;
}): ResolvedTraceSpans {
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
    return { resolvedSpans, recomputedInput: null, recomputedOutput: null, anyResolved: false };
  }

  return {
    resolvedSpans,
    recomputedInput: ioExtractionService.tryExtractFirstInput(resolvedSpans),
    recomputedOutput: ioExtractionService.tryExtractLastOutput(resolvedSpans),
    anyResolved: true,
  };
}
