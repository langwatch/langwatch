import {
  type AppendStore,
  type BulkAppendContext,
  type ProjectionStoreContext,
  SecurityError,
} from "@langwatch/eventing";

import type { SpanAnalyticsRepository } from "../repositories/span-analytics.repository.ts";
import type { SpanAnalyticsRow } from "./span-analytics.projection.ts";

const LOOKUP_SLICE_SIZE = 256;
/** A re-sent span whose StartTime moved up to a week still finds its first copy. */
const START_TIME_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * AppendStore adapter for the spanAnalytics map projection: stamps the tenant's trace retention
 * onto `_retention_days`, as stored_spans does, writes each span once (first write wins) by
 * looking up stored keys first (ADR-034 amendment), then delegates to the repository.
 */
export class SpanAnalyticsStore implements AppendStore<SpanAnalyticsRow> {
  private constructor(
    private readonly storage: SpanAnalyticsRepository,
    private readonly defaultRetentionDays: () => number,
  ) {}

  static create(options: {
    storage: SpanAnalyticsRepository;
    defaultRetentionDays: () => number;
  }): SpanAnalyticsStore {
    return new SpanAnalyticsStore(options.storage, options.defaultRetentionDays);
  }

  async append(record: SpanAnalyticsRow, context: ProjectionStoreContext): Promise<void> {
    await this.bulkAppend([record], context);
  }

  async bulkAppend(records: SpanAnalyticsRow[], context: BulkAppendContext): Promise<void> {
    assertSingleTenant(records);
    const fresh = await this.withoutStoredSpans(firstRowPerSpan(records));
    await this.storage.insertRows({ rows: fresh, retentionDays: this.retentionDays(context) });
  }

  private retentionDays(context: BulkAppendContext): number {
    return context.retentionPolicy?.traces ?? this.defaultRetentionDays();
  }

  /** Looks each 256-row slice up under its own StartTime bound; a failed lookup fails the batch. */
  private async withoutStoredSpans(rows: SpanAnalyticsRow[]): Promise<SpanAnalyticsRow[]> {
    const sorted = rows.toSorted((a, b) => a.startTimeUnixMs - b.startTimeUnixMs);
    const fresh: SpanAnalyticsRow[] = [];
    for (let start = 0; start < sorted.length; start += LOOKUP_SLICE_SIZE) {
      const slice = sorted.slice(start, start + LOOKUP_SLICE_SIZE);
      const [first] = slice;
      const last = slice[slice.length - 1];
      if (!first || !last) continue;
      const stored = await this.storage.existingSpanKeys({
        tenantId: first.tenantId,
        keys: slice.map(({ traceId, spanId }) => ({ traceId, spanId })),
        startTimeFromMs: first.startTimeUnixMs - START_TIME_MARGIN_MS,
        startTimeToMs: last.startTimeUnixMs + START_TIME_MARGIN_MS,
      });
      const storedKeys = new Set(
        stored.map((key) => spanKey({ tenantId: first.tenantId, ...key })),
      );
      fresh.push(...slice.filter((row) => !storedKeys.has(spanKey(row))));
    }
    return fresh;
  }
}

/** The lookup runs under the first row's tenant, so a mixed batch would read the wrong tenant. */
function assertSingleTenant(rows: SpanAnalyticsRow[]): void {
  const [first] = rows;
  if (!first) return;
  const mismatch = rows.find((row) => row.tenantId !== first.tenantId);
  if (!mismatch) return;
  throw new SecurityError({
    operation: "SpanAnalyticsStore.bulkAppend",
    message: "all rows in a single batch must share the same tenantId",
    tenantId: first.tenantId,
    context: { mismatchedTenantId: mismatch.tenantId },
  });
}

function spanKey({
  tenantId,
  traceId,
  spanId,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
}): string {
  return `${tenantId}:${traceId}:${spanId}`;
}

/** A re-sent span can share a coalesced batch with its original, and neither is stored yet. */
function firstRowPerSpan(rows: SpanAnalyticsRow[]): SpanAnalyticsRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = spanKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
