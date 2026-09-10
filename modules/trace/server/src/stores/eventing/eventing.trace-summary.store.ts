import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { TraceSummaryProjectionRepository } from "../../repositories/projection/trace-summary-projection.repository.ts";

/**
 * Thin FoldProjectionStore adapter for trace summaries. Delegates directly to
 * TraceSummaryRepository — no mapper needed since the projection uses camelCase types.
 */
export class TraceSummaryStore implements FoldProjectionStore<TraceSummaryData> {
  private constructor(
    private readonly storage: TraceSummaryProjectionRepository,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(options: {
    storage: TraceSummaryProjectionRepository;
    defaultRetentionDays: number;
  }): TraceSummaryStore {
    return new TraceSummaryStore(options.storage, options.defaultRetentionDays);
  }

  /**
   * Persists a single trace summary. Skips empty traces (spanCount 0) and
   * backfills the traceId from the aggregate id when the state omits it.
   */
  async store(state: TraceSummaryData, context: ProjectionStoreContext): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const stateWithId = state.traceId ? state : { ...state, traceId: String(context.aggregateId) };
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays;
    await this.storage.upsert({
      data: stateWithId,
      tenantId: String(context.tenantId),
      retentionDays,
    });
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
        data: state.traceId ? state : { ...state, traceId: String(context.aggregateId) },
        tenantId: String(context.tenantId),
        retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays,
      }));

    if (batchEntries.length === 0) return;

    await this.storage.upsertBatch(batchEntries);
  }

  async tryGet(
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
    return await this.storage.findByTraceId({
      tenantId: String(context.tenantId),
      traceId: aggregateId,
      window: context.readWindow,
    });
  }
}

/**
 * A fold state is worth persisting when it has at least one span, or log records that
 * contributed something a reader can see. The content check keeps ambient process telemetry
 * out: an agent that dies before its first prompt still emits lifecycle/error records, and
 * those must not mint a span-less row with no input, output or cost.
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
