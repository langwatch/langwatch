import type { Client as ElasticClient } from "@elastic/elasticsearch";
import type { Cursor, EsBatch, EsHit, EsStats, Logger, MigrationConfig } from "./types.js";

const FALLBACK_BATCH_SIZES = [500, 250, 100, 50, 1] as const;

export interface DiscoveredAggregate {
  tenantId: string;
  aggregateId: string;
}

export class EsScanner {
  constructor(
    private readonly client: ElasticClient,
    private readonly config: Pick<MigrationConfig, "batchSize">,
    private readonly logger: Logger,
    private readonly options: {
      index: string;
      sort: Array<Record<string, string>>;
      query?: Record<string, unknown>;
      timestampField?: string;
      statsField?: string;
      /** Field to aggregate on for discovery mode (e.g. "scenario_run_id"). */
      aggregateIdField?: string;
    },
  ) {}

  private get timestampField(): string {
    return (
      this.options.timestampField ??
      Object.keys(this.options.sort[0]!)[0]!
    );
  }

  private get statsField(): string {
    return this.options.statsField ?? this.timestampField;
  }

  async *scanWithPrefetch(cursor?: Cursor | null): AsyncGenerator<EsBatch> {
    const { batchSize } = this.config;
    const rangeFrom = cursor?.lastEventTimestamp ?? undefined;
    const initialSearchAfter = cursor?.sortValues ?? undefined;

    let currentPromise: Promise<EsBatch | null> = this.fetchWithFallback(
      batchSize,
      initialSearchAfter,
      rangeFrom,
    );

    while (true) {
      const result = await currentPromise;
      if (!result) break;

      const isLast = result.events.length < batchSize;

      const nextPromise = isLast
        ? Promise.resolve(null)
        : this.fetchWithFallback(batchSize, result.sortValues, rangeFrom);

      yield result;

      if (isLast) break;
      currentPromise = nextPromise;
    }
  }

  async getStats(cursor?: Cursor | null): Promise<EsStats> {
    const rangeFrom = cursor?.lastEventTimestamp ?? undefined;
    const field = this.statsField;
    const baseQuery = this.buildQuery(rangeFrom);

    const response = await this.client.search({
      index: this.options.index,
      track_total_hits: true,
      body: {
        size: 0,
        query: baseQuery,
        aggs: {
          stats: { stats: { field } },
        },
      },
    });

    const totalHits = response.hits.total;
    const total =
      typeof totalHits === "number"
        ? totalHits
        : (totalHits as { value: number })?.value ?? 0;

    const aggs = response.aggregations as
      | { stats: { min: number | null; max: number | null } }
      | undefined;

    return {
      totalEvents: total,
      minTimestamp: aggs?.stats?.min ?? 0,
      maxTimestamp: aggs?.stats?.max ?? 0,
    };
  }

  /**
   * Discover unique (tenantId, aggregateId) pairs within a time window.
   * Uses composite aggregation with two sources for correct tenant scoping.
   * Requires `aggregateIdField` to be set; `tenantIdField` provides the tenant.
   */
  async discoverAggregates(
    from: number,
    to: number,
    tenantIdField: string,
  ): Promise<DiscoveredAggregate[]> {
    const field = this.options.aggregateIdField;
    if (!field) {
      throw new Error("aggregateIdField is required for discovery mode");
    }

    const results: DiscoveredAggregate[] = [];
    let afterKey: Record<string, unknown> | undefined;

    while (true) {
      const query = this.buildRangeQuery(from, to);
      const compositeAgg: Record<string, unknown> = {
        composite: {
          size: 5000,
          sources: [
            { tenant_id: { terms: { field: tenantIdField } } },
            { agg_id: { terms: { field } } },
          ],
        },
      };
      if (afterKey) {
        (compositeAgg.composite as Record<string, unknown>).after = afterKey;
      }

      const response = await this.client.search({
        index: this.options.index,
        body: {
          size: 0,
          query,
          aggs: { discovery: compositeAgg },
        },
      });

      const agg = (response.aggregations as Record<string, unknown>)
        ?.discovery as
        | {
            buckets: Array<{ key: { tenant_id: string; agg_id: string } }>;
            after_key?: Record<string, unknown>;
          }
        | undefined;

      if (!agg?.buckets?.length) break;

      for (const bucket of agg.buckets) {
        results.push({
          tenantId: bucket.key.tenant_id,
          aggregateId: bucket.key.agg_id,
        });
      }

      afterKey = agg.after_key;
      if (!afterKey) break;
    }

    return results;
  }

  /**
   * Fetch all events for a specific (tenantId, aggregateId) pair.
   * Tenant-scoped to prevent cross-tenant data leakage.
   * Returns hits sorted by the configured sort order.
   */
  async fetchAggregateEvents(
    aggregateId: string,
    tenantId: string,
    tenantIdField: string,
  ): Promise<EsHit[]> {
    const field = this.options.aggregateIdField;
    if (!field) {
      throw new Error("aggregateIdField is required for fetchAggregateEvents");
    }

    const filters: Record<string, unknown>[] = [
      { term: { [tenantIdField]: tenantId } },
      { term: { [field]: aggregateId } },
    ];
    if (this.options.query) {
      filters.push(this.options.query);
    }

    const query =
      filters.length === 1 ? filters[0]! : { bool: { must: filters } };

    const response = await this.client.search<Record<string, unknown>>({
      index: this.options.index,
      body: {
        size: 10000,
        sort: this.options.sort,
        query,
      },
    });

    return response.hits.hits.map((hit) => ({
      _id: hit._id!,
      ...(hit._source as Record<string, unknown>),
    }));
  }

  /**
   * Fetch all events for multiple aggregates in a single bulk query.
   * Uses a `terms` filter on aggregateIdField to fetch everything at once,
   * then groups the results by "tenantId:aggregateId" composite key.
   * Paginates via search_after for large result sets.
   *
   * @param timeHint - Optional time range hint. Adds a generous ±24h range
   *   filter so ES can use its time-based index to pre-filter before applying
   *   the terms match. Does NOT limit results — just an optimization hint.
   */
  async fetchBulkAggregateEvents(
    aggregates: DiscoveredAggregate[],
    tenantIdField: string,
    timeHint?: { from: number; to: number },
  ): Promise<Map<string, EsHit[]>> {
    const field = this.options.aggregateIdField;
    if (!field) {
      throw new Error("aggregateIdField is required for fetchBulkAggregateEvents");
    }

    const aggregateIds = [...new Set(aggregates.map((a) => a.aggregateId))];
    if (aggregateIds.length === 0) return new Map();

    const filters: Record<string, unknown>[] = [
      { terms: { [field]: aggregateIds } },
    ];
    // Time-range hint: generous ±24h buffer to help ES narrow down shards/segments
    if (timeHint) {
      const BUFFER_MS = 24 * 60 * 60 * 1000;
      filters.push({
        range: {
          [this.timestampField]: {
            gte: timeHint.from - BUFFER_MS,
            lt: timeHint.to + BUFFER_MS,
          },
        },
      });
    }
    if (this.options.query) {
      filters.push(this.options.query);
    }
    const query =
      filters.length === 1 ? filters[0]! : { bool: { must: filters } };

    const PAGE_SIZE = 10_000;
    const allHits: EsHit[] = [];
    let searchAfter: unknown[] | undefined;

    while (true) {
      const body: Record<string, unknown> = {
        size: PAGE_SIZE,
        sort: this.options.sort,
        query,
      };
      if (searchAfter) body.search_after = searchAfter;

      const response = await this.client.search<Record<string, unknown>>({
        index: this.options.index,
        body,
      });

      const hits = response.hits.hits;
      if (hits.length === 0) break;

      for (const hit of hits) {
        allHits.push({
          _id: hit._id!,
          ...(hit._source as Record<string, unknown>),
        });
      }

      if (hits.length < PAGE_SIZE) break;
      searchAfter = hits[hits.length - 1]!.sort as unknown[];
    }

    // Group by "tenantId:aggregateId"
    const grouped = new Map<string, EsHit[]>();
    for (const hit of allHits) {
      const tenantId = (hit as Record<string, unknown>)[tenantIdField] as string;
      const aggregateId = (hit as Record<string, unknown>)[field] as string;
      const key = `${tenantId}:${aggregateId}`;
      let events = grouped.get(key);
      if (!events) {
        events = [];
        grouped.set(key, events);
      }
      events.push(hit);
    }

    return grouped;
  }

  private buildRangeQuery(from: number, to: number): Record<string, unknown> {
    const filters: Record<string, unknown>[] = [
      { range: { [this.timestampField]: { gte: from, lt: to } } },
    ];
    if (this.options.query) {
      filters.push(this.options.query);
    }
    if (filters.length === 1) return filters[0]!;
    return { bool: { must: filters } };
  }

  private buildQuery(rangeFrom?: number): Record<string, unknown> {
    const filters: Record<string, unknown>[] = [];
    if (rangeFrom !== undefined) {
      filters.push({ range: { [this.timestampField]: { gte: rangeFrom } } });
    }
    if (this.options.query) {
      filters.push(this.options.query);
    }
    if (filters.length === 0) return { match_all: {} };
    if (filters.length === 1) return filters[0]!;
    return { bool: { must: filters } };
  }

  private async fetchWithFallback(
    batchSize: number,
    searchAfter: unknown[] | undefined,
    rangeFrom?: number,
  ): Promise<EsBatch | null> {
    try {
      return await this.fetchBatch(batchSize, searchAfter, rangeFrom);
    } catch (err) {
      this.logger.warn("Batch fetch failed, will retry with smaller sizes", {
        batchSize,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const fallbackSize of FALLBACK_BATCH_SIZES) {
      if (fallbackSize >= batchSize) continue;
      try {
        this.logger.info("Retrying with smaller batch size", {
          batchSize: fallbackSize,
        });
        return await this.fetchBatch(fallbackSize, searchAfter, rangeFrom);
      } catch (err) {
        this.logger.warn("Smaller batch also failed", {
          batchSize: fallbackSize,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    throw new Error(
      `ES fetch failed at all batch sizes (${batchSize}, ${FALLBACK_BATCH_SIZES.join(", ")})`,
    );
  }

  private async fetchBatch(
    size: number,
    searchAfter: unknown[] | undefined,
    rangeFrom?: number,
  ): Promise<EsBatch | null> {
    const query = this.buildQuery(rangeFrom);

    const body: Record<string, unknown> = {
      size,
      sort: this.options.sort,
      query,
    };

    if (searchAfter) {
      body.search_after = searchAfter;
    }

    const response = await this.client.search<Record<string, unknown>>({
      index: this.options.index,
      body,
    });

    const hits = response.hits.hits;
    if (hits.length === 0) return null;

    const events: EsHit[] = hits.map((hit) => ({
      _id: hit._id!,
      ...(hit._source as Record<string, unknown>),
    }));

    const lastHit = hits[hits.length - 1]!;
    const sortValues = lastHit.sort as unknown[];

    return { events, sortValues };
  }
}
