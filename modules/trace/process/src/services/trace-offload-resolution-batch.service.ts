import { EventNotFoundError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { NormalizedAttributes, NormalizedSpan } from "@langwatch/trace-contract";

import type { TraceIOExtractionService } from "#features/derivation/services/trace-io-extraction.service";

/**
 * Bulk read-path resolution of offloaded trace event refs (ADR-022). The refs of the whole result
 * set go to one recall, which reads each trace event once for all its fields through a bounded
 * pool and caps what any one trace brings back; a failure warns and keeps the preview.
 */
import type { ResolveTraceSpansBatchFn } from "../features/legacy/repositories/trace-legacy-read.repository.ts";
import type { BlobResolutionDeps } from "../features/legacy/services/trace-legacy-read.service.ts";
import type { TraceBlobStoreService } from "../features/media/services/trace-blob-store.service.ts";
import {
  BlobFieldNotFoundError,
  BlobNotFoundError,
} from "../features/media/services/trace-blob-store.service.ts";
import {
  type OffloadRecallOutcome,
  OFFLOAD_RECALL_CONCURRENCY,
  TraceEventPayloadFieldNotFoundError,
  TraceOffloadBudgetExceededError,
} from "../repositories/trace-payload-reader.repository.ts";
import { hasEventRefs, parseSpanEventRefs } from "../rules/trace-event-ref-parsing.rules.ts";
import {
  type OffloadedFieldReference,
  offloadedFieldKey,
} from "../rules/trace-offload-recall.rules.ts";
import type { ResolvedTraceSpans, WarnLogger } from "./trace-offload-resolution.service.ts";

const offloadResolutionLogger = createLogger("langwatch:traces:clickhouse-legacy-read");

/** Internal: per-span plan built in the parse phase. */
interface SpanPlan {
  /** Preview/regular attributes with reserved keys removed. */
  cleanedAttrs: NormalizedAttributes;
  /** Which recalled field fills which attribute key. */
  refs: { attrKey: string; fetchKey: string }[];
  /** False when the span had no eventrefs (returned untouched). */
  hadRefs: boolean;
}

/** Logs a per-field resolution failure at warn level (no silent truncation). */
function warnResolutionFailure({
  logger,
  projectId,
  span,
  attrKey,
  error,
}: {
  logger: WarnLogger;
  projectId: string;
  span: NormalizedSpan;
  attrKey: string;
  error: unknown;
}): void {
  // The recall already said once, per trace, that its budget ran out.
  if (error instanceof TraceOffloadBudgetExceededError) return;
  if (
    error instanceof EventNotFoundError ||
    error instanceof TraceEventPayloadFieldNotFoundError ||
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

export class TraceOffloadResolutionBatchService {
  static create(): TraceOffloadResolutionBatchService {
    return new TraceOffloadResolutionBatchService();
  }

  private constructor() {}

  /** The whole-result-set resolver a legacy read calls, bound to one blob store. */
  resolverFor(deps: BlobResolutionDeps): ResolveTraceSpansBatchFn {
    return (projectId, spansPerTrace) =>
      this.resolveOffloadedTracesBatch({
        projectId,
        spansPerTrace,
        blobStore: deps.blobStore,
        ioExtractionService: deps.ioExtractionService,
        logger: offloadResolutionLogger,
      });
  }

  /**
   * Resolves refs for a whole result set in one bounded pass; see the module doc. Takes the tenant,
   * per-trace span arrays in result order, the blob store, IO recomputation and a warning logger,
   * plus the aggregate type and read concurrency. Returns one entry per trace, in input order.
   */
  async resolveOffloadedTracesBatch({
    projectId,
    spansPerTrace,
    blobStore,
    ioExtractionService,
    logger,
    concurrency = OFFLOAD_RECALL_CONCURRENCY,
  }: {
    projectId: string;
    spansPerTrace: NormalizedSpan[][];
    blobStore: TraceBlobStoreService;
    ioExtractionService: TraceIOExtractionService;
    logger: WarnLogger;
    concurrency?: number;
  }): Promise<ResolvedTraceSpans[]> {
    const references: OffloadedFieldReference[] = [];
    const tracePlans: SpanPlan[][] = spansPerTrace.map((spans) =>
      spans.map((span) => planSpan({ span, projectId, logger, references })),
    );

    const fetchResults = await blobStore.recallFromEventLog({
      tenantId: projectId,
      references,
      concurrency,
    });

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
 * Its references join the result set's; the recall collapses repeats and reads each event once.
 */
function planSpan({
  span,
  projectId,
  logger,
  references,
}: {
  span: NormalizedSpan;
  projectId: string;
  logger: WarnLogger;
  references: OffloadedFieldReference[];
}): SpanPlan {
  const attrs = span.spanAttributes;
  if (!hasEventRefs(attrs)) {
    return { cleanedAttrs: attrs, refs: [], hadRefs: false };
  }

  const { cleanedAttrs, eventrefEntries, missingEventIdKeys } = parseSpanEventRefs(attrs);
  for (const attrKey of missingEventIdKeys) {
    logger.warn(
      { projectId, spanId: span.spanId, traceId: span.traceId, attrKey },
      "eventref missing eventId — keeping preview value",
    );
  }

  // ADR-022: the aggregate id for the trace-processing pipeline is the traceId.
  const aggregateId = span.traceId;
  const refs = eventrefEntries.map(({ attrKey, field, eventId }) => {
    const reference = { traceId: aggregateId, eventId, field };
    references.push(reference);
    return { attrKey, fetchKey: offloadedFieldKey(reference) };
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
  fetchResults: Map<string, OffloadRecallOutcome>;
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
        warnResolutionFailure({ logger, projectId, span, attrKey, error: result.error });
      }
    }

    return { ...span, spanAttributes: resolvedAttrs };
  });

  if (!anyResolved) {
    return { resolvedSpans, recomputedInput: null, recomputedOutput: null, anyResolved: false };
  }

  return {
    resolvedSpans,
    recomputedInput: ioExtractionService.extractFirstInput(resolvedSpans),
    recomputedOutput: ioExtractionService.extractLastOutput(resolvedSpans),
    anyResolved: true,
  };
}
