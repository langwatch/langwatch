import type { FoldProjectionStore } from "@langwatch/eventing";
import { RedisCachedFoldStore } from "@langwatch/eventing";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  TraceSummaryProjectionPort,
  TraceSummaryStore,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
  type TraceSummaryRepository,
} from "@langwatch/trace-server";
import type { Cluster, Redis } from "ioredis";

class AppTraceSummaryProjectionAdapter extends TraceSummaryProjectionPort {
  private constructor(private readonly repository: TraceSummaryRepository) {
    super();
  }

  static create(repository: TraceSummaryRepository): AppTraceSummaryProjectionAdapter {
    return new AppTraceSummaryProjectionAdapter(repository);
  }

  async upsert(entry: TraceSummaryProjectionEntry): Promise<void> {
    await this.repository.upsert(entry.data, entry.tenantId, entry.retentionDays);
  }

  async upsertBatch(entries: TraceSummaryProjectionEntry[]): Promise<void> {
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
    return this.repository.findByTraceId(input.tenantId, input.traceId, {
      window: input.window,
    });
  }
}

export function createAppTraceSummaryStore(options: {
  repository: TraceSummaryRepository;
  redis: Redis | Cluster | null;
  defaultRetentionDays: number;
  foldCacheTtlSeconds?: number;
}): FoldProjectionStore<TraceSummaryData> {
  const durable = TraceSummaryStore.create({
    storage: AppTraceSummaryProjectionAdapter.create(options.repository),
    defaultRetentionDays: options.defaultRetentionDays,
  });

  return options.redis
    ? new RedisCachedFoldStore(durable, options.redis, {
        keyPrefix: "trace_summaries",
        ttlSeconds: options.foldCacheTtlSeconds,
      })
    : durable;
}
