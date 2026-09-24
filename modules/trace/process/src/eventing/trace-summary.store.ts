import type {
  FoldProjectionStore,
  ProjectionStoreContext,
  FoldStateRead,
} from "@langwatch/eventing";
import type { TraceSummaryData } from "@langwatch/trace-contract";

import type { TraceSummaryProjectionRepository } from "../repositories/projection/trace-summary-projection.repository.ts";

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
    entries: {
      state: TraceSummaryData;
      context: ProjectionStoreContext;
    }[],
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

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<TraceSummaryData>> {
    // `context.readWindow` bounds this read so trace_summaries (partitioned
    // by toYearWeek) prunes instead of cold-scanning. The EXECUTOR retries a
    // windowed miss without the window — correctness never depends on width.
    const folded = await this.storage.findByTraceId({
      tenantId: String(context.tenantId),
      traceId: aggregateId,
      window: context.readWindow,
    });
    return folded === null ? { kind: "empty" } : { kind: "folded", state: folded };
  }
}

/**
 * A fold state is worth persisting only with a span, or a log record a
 * reader can see. This keeps ambient telemetry out: an agent dying before
 * its first prompt still emits lifecycle records, but must not mint a row.
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
