import type { TraceSummaryData } from "@langwatch/trace-contract";
import type { TraceAnalyticsRow } from "../projections/trace-derived.projection";
import type { TraceClickHouseWriteResolver } from "../ports/clickhouse.port";
import {
  TraceAnalyticsProjectionPort,
  type TraceAnalyticsProjectionEntry,
  type TraceAnalyticsProjectionRead,
} from "../ports/trace-analytics-projection.port";
import { TraceAnalyticsRollupPort } from "../ports/trace-analytics-rollup.port";
import {
  TraceSummaryProjectionPort,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "../ports/trace-summary-projection.port";
import type { TraceAnalyticsRollupRow } from "../projections/trace-rollup.projection";
import type { TraceAnalyticsRepository } from "../repositories/trace-analytics.repository";
import type { TraceAnalyticsRollupRepository } from "../repositories/trace-analytics-rollup.repository";
import type { TraceSummaryRepository } from "../repositories/trace-summary.repository";
import { TraceAnalyticsClickHouseRepository } from "../repositories/clickhouse/trace-analytics.repository";
import { TraceAnalyticsRollupClickHouseRepository } from "../repositories/clickhouse/trace-analytics-rollup.repository";
import { TraceSummaryClickHouseRepository } from "../repositories/clickhouse/trace-summary.repository";

/**
 * The three projection-storage bridges, composed from nothing but a
 * tenant-keyed ClickHouse client and the retention fallback the event store
 * already stamps.
 *
 * WHY THESE EXIST AT ALL, because it is not obvious from the file count. This
 * package already owned both ends: the three ClickHouse repositories that write
 * `trace_summaries`, `trace_analytics` and `trace_analytics_rollup`, and the
 * three ports the projection stores take. What was missing was the twenty lines
 * of translation between them — positional repository arguments on one side, a
 * named entry on the other — and those twenty lines lived in
 * `platform/app/src/runtime/app/`. So a background process holding a perfectly
 * good ClickHouse client could build every repository this pipeline needs and
 * still not build a single one of its stores.
 *
 * The translation is where the batch fallback lives, and it is deliberate on
 * both sides: a repository that publishes no `upsertBatch` gets one built out
 * of its single-row write rather than the port throwing, because a store that
 * refused a batch would stall the fold rather than slow it.
 */
class ClickHouseTraceSummaryProjectionAdapter extends TraceSummaryProjectionPort {
  constructor(private readonly repository: TraceSummaryRepository) {
    super();
  }

  async upsert(entry: TraceSummaryProjectionEntry): Promise<void> {
    await this.repository.upsert(entry.data, entry.tenantId, entry.retentionDays);
  }

  override async upsertBatch(entries: TraceSummaryProjectionEntry[]): Promise<void> {
    if (entries.length === 0) return;

    if (this.repository.upsertBatch) {
      await this.repository.upsertBatch(entries);
      return;
    }

    await Promise.all(entries.map((entry) => this.upsert(entry)));
  }

  tryFindByTraceId(input: {
    tenantId: string;
    traceId: string;
    window?: TraceSummaryReadWindow;
  }): Promise<TraceSummaryData | null> {
    return this.repository.findByTraceId(
      { tenantId: input.tenantId, traceId: input.traceId },
      { window: input.window },
    );
  }
}

class ClickHouseTraceAnalyticsProjectionAdapter extends TraceAnalyticsProjectionPort {
  constructor(private readonly repository: TraceAnalyticsRepository) {
    super();
  }

  async upsert(entry: TraceAnalyticsProjectionEntry): Promise<void> {
    await this.repository.upsert(entry.row, entry.retentionDays, entry.appliedEventIds);
  }

  override async upsertBatch(entries: TraceAnalyticsProjectionEntry[]): Promise<void> {
    if (entries.length === 0) return;

    if (this.repository.upsertBatch) {
      await this.repository.upsertBatch(entries);
      return;
    }

    for (const entry of entries) {
      await this.upsert(entry);
    }
  }

  tryFindByTraceId(input: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<TraceAnalyticsProjectionRead | null> {
    return this.repository.tryFindByTraceIdWithApplied(input);
  }
}

class ClickHouseTraceAnalyticsRollupAdapter extends TraceAnalyticsRollupPort {
  constructor(private readonly repository: TraceAnalyticsRollupRepository) {
    super();
  }

  async insertRow(input: { row: TraceAnalyticsRollupRow; retentionDays: number }): Promise<void> {
    await this.repository.insertRow(input.row, input.retentionDays);
  }

  async insertRows(input: {
    rows: TraceAnalyticsRollupRow[];
    retentionDays: number;
  }): Promise<void> {
    await this.repository.insertRows(input.rows, input.retentionDays);
  }
}

export type ClickHouseTraceProjectionStorageOptions = {
  resolveClient: TraceClickHouseWriteResolver;
  /** The fallback stamped on a row that declares no retention of its own. */
  defaultRetentionDays: number;
};

/** The three projection-storage ports, each over its own ClickHouse repository. */
export class ClickHouseTraceProjectionStorageAdapter {
  private constructor() {}

  static createSummary(
    options: ClickHouseTraceProjectionStorageOptions,
  ): TraceSummaryProjectionPort {
    return new ClickHouseTraceSummaryProjectionAdapter(
      TraceSummaryClickHouseRepository.create(options),
    );
  }

  static createAnalytics(
    options: ClickHouseTraceProjectionStorageOptions,
  ): TraceAnalyticsProjectionPort {
    return new ClickHouseTraceAnalyticsProjectionAdapter(
      TraceAnalyticsClickHouseRepository.create(options),
    );
  }

  static createAnalyticsRollup(
    options: ClickHouseTraceProjectionStorageOptions,
  ): TraceAnalyticsRollupPort {
    return new ClickHouseTraceAnalyticsRollupAdapter(
      TraceAnalyticsRollupClickHouseRepository.create(options),
    );
  }
}
