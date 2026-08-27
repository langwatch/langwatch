import type { SpanStorageRepository } from "~/server/app-layer/traces/repositories/span-storage.repository";
import type { SpanInsertData } from "@langwatch/trace-contract";
import {
  TraceAnalyticsProjectionPort,
  TraceAnalyticsRollupPort,
  TraceAnalyticsStore,
  SpanStorageStore,
  TraceSpanStoragePort,
  type TraceAnalyticsRollupRow,
  type TraceAnalyticsRow,
  type TraceAnalyticsRepository,
  type TraceAnalyticsRollupRepository,
} from "@langwatch/trace-server";

export type AppTraceProjectionStorage = {
  spans: TraceSpanStoragePort;
  analytics: TraceAnalyticsProjectionPort;
  analyticsRollup: TraceAnalyticsRollupPort;
};

class AppTraceSpanStorageAdapter extends TraceSpanStoragePort {
  private constructor(private readonly repository: SpanStorageRepository) {
    super();
  }

  static create(repository: SpanStorageRepository): AppTraceSpanStorageAdapter {
    return new AppTraceSpanStorageAdapter(repository);
  }

  async insertSpan(span: SpanInsertData): Promise<void> {
    await this.repository.insertSpan(span);
  }

  async insertSpans(spans: SpanInsertData[]): Promise<void> {
    await this.repository.insertSpans(spans);
  }
}

class AppTraceAnalyticsRollupAdapter extends TraceAnalyticsRollupPort {
  private constructor(private readonly repository: TraceAnalyticsRollupRepository) {
    super();
  }

  static create(repository: TraceAnalyticsRollupRepository): AppTraceAnalyticsRollupAdapter {
    return new AppTraceAnalyticsRollupAdapter(repository);
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

class AppTraceAnalyticsProjectionAdapter extends TraceAnalyticsProjectionPort {
  private constructor(private readonly repository: TraceAnalyticsRepository) {
    super();
  }

  static create(repository: TraceAnalyticsRepository): AppTraceAnalyticsProjectionAdapter {
    return new AppTraceAnalyticsProjectionAdapter(repository);
  }

  async upsert(entry: {
    row: TraceAnalyticsRow;
    retentionDays: number;
    appliedEventIds: string[];
  }): Promise<void> {
    await this.repository.upsert(entry.row, entry.retentionDays, entry.appliedEventIds);
  }

  async upsertBatch(
    entries: Array<{
      row: TraceAnalyticsRow;
      retentionDays: number;
      appliedEventIds: string[];
    }>,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    if (this.repository.upsertBatch) {
      await this.repository.upsertBatch(entries);
      return;
    }

    for (const entry of entries) {
      await this.upsert(entry);
    }
  }

  async tryFindByTraceId(input: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }) {
    return await this.repository.findByTraceIdWithApplied(input);
  }
}

/** App composition adapters for Trace's package-owned projection stores. */
export class AppTraceProjectionStorageAdapter {
  private constructor() {}

  static createSpanStorage(repository: SpanStorageRepository): TraceSpanStoragePort {
    return AppTraceSpanStorageAdapter.create(repository);
  }

  static createSpanStore(options: {
    repository: SpanStorageRepository;
    defaultRetentionDays: number;
  }): SpanStorageStore {
    return SpanStorageStore.create({
      storage: this.createSpanStorage(options.repository),
      defaultRetentionDays: options.defaultRetentionDays,
    });
  }

  static createAnalyticsRollup(
    repository: TraceAnalyticsRollupRepository,
  ): TraceAnalyticsRollupPort {
    return AppTraceAnalyticsRollupAdapter.create(repository);
  }

  static createAnalytics(repository: TraceAnalyticsRepository): TraceAnalyticsProjectionPort {
    return AppTraceAnalyticsProjectionAdapter.create(repository);
  }

  static createAnalyticsStore(options: {
    repository: TraceAnalyticsRepository;
    defaultRetentionDays: number;
  }): TraceAnalyticsStore {
    return TraceAnalyticsStore.create({
      storage: this.createAnalytics(options.repository),
      defaultRetentionDays: options.defaultRetentionDays,
    });
  }

  static create(options: {
    spans: SpanStorageRepository;
    analytics: TraceAnalyticsRepository;
    analyticsRollup: TraceAnalyticsRollupRepository;
  }): AppTraceProjectionStorage {
    return {
      spans: this.createSpanStorage(options.spans),
      analytics: this.createAnalytics(options.analytics),
      analyticsRollup: this.createAnalyticsRollup(options.analyticsRollup),
    };
  }
}
