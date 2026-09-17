/**
 * LangWatchQL app functions — where hydration reads traces from.
 *
 * A narrow seam over the trace read path, for two reasons. The first is
 * ordinary: the hydrator's rules about caps, truncation and unresolved keys are
 * worth testing without a datastore. The second is the one that matters — this
 * is the boundary where tenancy is re-established. The database bounded the
 * *query* through the row policy, but the keys the query returned are then
 * handed back to the application, and a fetch that took them at face value
 * would read whatever trace they named. Every method here therefore takes the
 * project and the caller's `Protections` and goes through `TraceService`, which
 * filters on `TenantId` and applies field redaction. There is no raw ClickHouse
 * query in this slice and there must never be one.
 *
 * Reads resolve offloaded content (`{ full: true }`, ADR-022) for the same
 * reason the evaluation path does: a value cut to the 64 KB preview is a
 * silently shortened answer, and these functions exist to hand a reader the
 * whole thing.
 *
 * @see ./hydrate.ts
 * @see ~/server/traces/trace.service.ts
 */

import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { TraceService } from "~/server/traces/trace.service";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";

/** What hydration needs from the trace read path, and nothing more. */
export interface LangWatchQLAppFunctionTraceSource {
  /** Traces named by id, with their spans. Order is not promised. */
  tracesByIds(input: {
    projectId: string;
    traceIds: readonly string[];
    protections: Protections;
  }): Promise<Trace[]>;
  /**
   * Every trace of the named threads, with their spans.
   *
   * The thread key is `Attributes['gen_ai.conversation.id']`, which is the one
   * thread identity after the fold, and the read maps it back onto
   * `metadata.thread_id` — which is how the caller tells the returned traces
   * apart by thread.
   */
  tracesByThreadKeys(input: {
    projectId: string;
    threadKeys: readonly string[];
    protections: Protections;
  }): Promise<Trace[]>;
}

/**
 * The shipped source, over `TraceService`.
 *
 * Built per hydration rather than held: `TraceService.create` opens no
 * connection of its own (it resolves a client per project on first read), and a
 * process-wide instance would be a second lifecycle to reason about for no
 * saving.
 */
export function createLangWatchQLAppFunctionTraceSource(): LangWatchQLAppFunctionTraceSource {
  const service = TraceService.create(
    undefined,
    buildTraceBlobResolutionDeps(),
  );
  return {
    async tracesByIds({ projectId, traceIds, protections }) {
      if (traceIds.length === 0) return [];
      return await service.getTracesWithSpans(
        projectId,
        [...traceIds],
        protections,
        undefined,
        { full: true },
      );
    },
    async tracesByThreadKeys({ projectId, threadKeys, protections }) {
      if (threadKeys.length === 0) return [];
      return await service.getTracesWithSpansByThreadIds(
        projectId,
        [...threadKeys],
        protections,
        { full: true },
      );
    },
  };
}
