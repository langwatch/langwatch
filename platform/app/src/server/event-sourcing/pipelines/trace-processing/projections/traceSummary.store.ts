import type {
  FoldProjectionStore,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";

/**
 * Thin FoldProjectionStore adapter for trace summaries.
 * Delegates directly to TraceSummaryRepository (no mapper needed — projection uses camelCase types).
 */
export class TraceSummaryStore
  implements FoldProjectionStore<TraceSummaryData>
{
  constructor(private readonly repo: TraceSummaryRepository) {}

  /**
   * Persists a single trace summary. Skips empty traces (spanCount 0) and
   * backfills the traceId from the aggregate id when the state omits it.
   */
  async store(
    state: TraceSummaryData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const stateWithId = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.upsert(
      stateWithId,
      String(context.tenantId),
      retentionDays,
    );
  }

  /**
   * Persists many trace summaries in one round-trip. Empty traces are dropped
   * and the repository's batch upsert is used when available, falling back to
   * per-entry upserts otherwise.
   */
  async storeBatch(
    entries: Array<{
      state: TraceSummaryData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchEntries = entries
      .filter(({ state }) => hasPersistableSignal(state))
      .map(({ state, context }) => ({
        data: state.traceId
          ? state
          : { ...state, traceId: String(context.aggregateId) },
        tenantId: String(context.tenantId),
        retentionDays:
          context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
      }));

    if (batchEntries.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchEntries);
    } else {
      await Promise.all(
        batchEntries.map(({ data, tenantId, retentionDays }) =>
          this.repo.upsert(data, tenantId, retentionDays),
        ),
      );
    }
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TraceSummaryData | null> {
    // `context.readWindow` — computed by the executor from the fold's declared
    // `options.readWindow` — bounds this read so trace_summaries (partitioned
    // by toYearWeek(OccurredAt)) prunes partitions instead of cold-scanning
    // them all (incl. S3 tier). Passed through verbatim, and the repository
    // applies it verbatim (no internal fallback on this path): the EXECUTOR
    // retries a windowed miss without the window, which lands on the
    // repository's resolve-OccurredAt path — so correctness never depends on
    // the width, and no layer runs a second recovery ladder.
    return await this.repo.findByTraceId(
      String(context.tenantId),
      aggregateId,
      context.readWindow !== undefined
        ? { window: context.readWindow }
        : undefined,
    );
  }
}

/**
 * A fold state is worth persisting when it has at least one span, OR log
 * records that contributed something a reader can see. Log-only traces
 * (claude Path B + OTEL_LOGS_EXPORTER without a traces exporter, codex
 * Path B pre-codex-spans, custom gen_ai-on-logs emitters) are a supported
 * shape, and they reach trace_summaries through the second arm.
 *
 * The content check is what keeps ambient process telemetry out: an agent
 * that starts and dies before its first prompt still emits lifecycle and
 * error records, which fold into a state with a log count and nothing
 * else. Persisting those minted span-less rows with no input, no output
 * and no cost — one per dead agent per boot. The records themselves stay
 * stored either way; only the row waits for the trace to say something.
 */
function hasPersistableSignal(state: TraceSummaryData): boolean {
  if (state.spanCount > 0) return true;
  const raw = state.attributes?.["langwatch.reserved.log_record_count"];
  const hasLogRecords = typeof raw === "string" && Number(raw) > 0;
  if (!hasLogRecords) return false;
  return (
    state.computedInput !== null ||
    state.computedOutput !== null ||
    state.totalCost !== null ||
    state.totalPromptTokenCount !== null ||
    state.totalCompletionTokenCount !== null ||
    state.models.length > 0
  );
}
