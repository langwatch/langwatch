import type { CommandHandlerOptions } from "../../../pipeline/staticBuilder.types";
import type { RecordSpanCommandData } from "../schemas/commands";
import { TraceRequestUtils } from "../utils/traceRequest.utils";
import { RECORD_SPAN_DEDUPLICATION } from "./recordSpanCommand";
import {
  clampSpanShardCount,
  spanCommandGroupKey,
} from "./spanCommandGroupKey";

/**
 * How the `recordSpan` command is queued: its dedup window, and — when
 * sharding is on — the GroupQueue key that spreads one trace's spans across
 * `traceId:<shard>` groups.
 *
 * Resolved here rather than in `pipeline.ts` because it is a decision, not
 * structure: a clamp, a branch and a closure over the resolved count. Per
 * ADR-102, a mounted member is constructed in `pipeline.ts`, not decided
 * there, and this is the argument that construction takes.
 *
 * When sharding is disabled (the default) NO `getGroupKey` is installed — the
 * command falls back to `getAggregateId`, byte-identical to the historic
 * per-trace key and with zero extra work on the span-ingest hot path. The count
 * is clamped defensively so a caller constructing the pipeline directly
 * (bypassing PipelineRegistry's env resolver) cannot explode the number of
 * groups. The command handler reads no trace state and the emitted
 * `span_received` event still carries `aggregateId = traceId`, so the
 * trace-summary fold (on its own aggregate-keyed queue) is unaffected and the
 * summary stays exact. See `spanCommandGroupKey.ts` and
 * `specs/event-sourcing/span-command-sharding.feature`.
 */
export function recordSpanOptions({
  spanCommandShardCount,
}: {
  spanCommandShardCount: number | undefined;
}): CommandHandlerOptions<RecordSpanCommandData> {
  const shardCount = clampSpanShardCount(spanCommandShardCount ?? 1);

  if (shardCount <= 1) {
    return { deduplication: RECORD_SPAN_DEDUPLICATION };
  }

  return {
    deduplication: RECORD_SPAN_DEDUPLICATION,
    getGroupKey: (payload) => {
      const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
        payload.span,
      );
      return spanCommandGroupKey({ traceId, spanId, shardCount });
    },
  };
}
