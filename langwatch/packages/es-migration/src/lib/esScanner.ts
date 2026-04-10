import { appendFile } from "node:fs/promises";
import type { Client as ElasticClient } from "@elastic/elasticsearch";
import type { Cursor, EsBatch, EsHit, EsStats, Logger, MigrationConfig } from "./types.js";

const FALLBACK_BATCH_SIZES = [2000, 1000, 750, 500, 250, 100, 50, 1] as const;

/** No data before 2020-01-01 should ever be queried — guard against corrupt timestamps. */
const MIN_TIMESTAMP_MS = new Date("2020-01-01T00:00:00Z").getTime();

const MAX_BACKOFF_ATTEMPTS = 5;
const ES_RECOVERY_POLL_MS = 10_000;
const ES_RECOVERY_MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

const TRANSIENT_ES_ERRORS = [
  "no_shard_available_action_exception",
  "search_phase_execution_exception",
  "Request timed out",
  "connect ETIMEDOUT",
  "connect ECONNREFUSED",
  "ConnectionError",
  "circuit_breaking_exception",
  "security_exception",
];

function isTransientEsError(msg: string): boolean {
  return TRANSIENT_ES_ERRORS.some((e) => msg.includes(e));
}

function isShardCrashError(msg: string): boolean {
  return msg.includes("no_shard_available_action_exception");
}

function isContentTooLargeError(msg: string): boolean {
  return msg.includes("maximum allowed string") || msg.includes("Invalid string length");
}

export interface DiscoveredAggregate {
  tenantId: string;
  aggregateId: string;
}

export class EsScanner {
  /** Adaptive batch size — reduced when responses exceed V8 string limit. */
  private effectiveBatchSize: number;

  /** Upper bound for batch size recovery — set to half the size that last crashed a shard. */
  private maxSafeSize: number;

  /** ES doc IDs that were skipped because they crashed ES shards. */
  readonly skippedDocIds: string[] = [];

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
  ) {
    this.effectiveBatchSize = config.batchSize;
    this.maxSafeSize = config.batchSize;
  }

  /**
   * Poll ES until it responds to a simple query.
   * Used after a shard crash to wait for the cluster to recover.
   */
  private async waitForEsRecovery(): Promise<void> {
    this.logger.info("Shard crashed — waiting for ES to recover…");
    const startTime = Date.now();

    while (Date.now() - startTime < ES_RECOVERY_MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, ES_RECOVERY_POLL_MS));
      try {
        await this.client.search({
          index: this.options.index,
          body: { size: 0, query: { match_all: {} } },
        });
        const downSec = Math.round((Date.now() - startTime) / 1000);
        this.logger.info(`ES recovered after ${downSec}s`);
        return;
      } catch {
        // still down — keep polling
      }
    }
    throw new Error(
      `ES did not recover after ${ES_RECOVERY_MAX_WAIT_MS / 1000}s`,
    );
  }

  /**
   * Fetch just the sort values of the next document WITHOUT loading _source.
   * Used to skip past a toxic document that crashes ES when fully loaded.
   */
  private async peekNextDocSortValues(
    searchAfter: unknown[] | undefined,
    rangeFrom?: number,
  ): Promise<{ docId: string; sortValues: unknown[] } | null> {
    const query = this.buildQuery(rangeFrom);
    const body: Record<string, unknown> = {
      size: 1,
      sort: this.options.sort,
      query,
      _source: false,
    };
    if (searchAfter) body.search_after = searchAfter;

    const response = await this.client.search({
      index: this.options.index,
      body,
    });

    const hit = response.hits.hits[0];
    if (!hit) return null;

    return {
      docId: hit._id!,
      sortValues: [...(hit.sort as unknown[])],
    };
  }

  private get timestampField(): string {
    return (
      this.options.timestampField ??
      Object.keys(this.options.sort[0]!)[0]!
    );
  }

  private get statsField(): string {
    return this.options.statsField ?? this.timestampField;
  }

  /**
   * Retry a function with exponential backoff on transient ES errors.
   */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= MAX_BACKOFF_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delaySec = Math.min(10 * 2 ** (attempt - 1), 120);
        this.logger.info(`[${label}] Backing off ${delaySec}s before retry (attempt ${attempt}/${MAX_BACKOFF_ATTEMPTS})`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }

      try {
        return await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isTransientEsError(msg) && attempt < MAX_BACKOFF_ATTEMPTS) {
          this.logger.warn(`[${label}] Transient ES error, will back off`, {
            error: msg,
            attempt,
          });
          continue;
        }
        throw err;
      }
    }

    throw new Error(`[${label}] ES request failed after ${MAX_BACKOFF_ATTEMPTS} backoff attempts`);
  }

  async *scanWithPrefetch(cursor?: Cursor | null): AsyncGenerator<EsBatch> {
    const rangeFrom = cursor?.lastEventTimestamp ?? undefined;
    const initialSearchAfter = cursor?.sortValues ?? undefined;

    let currentPromise: Promise<EsBatch | null> = this.fetchWithFallback(
      this.effectiveBatchSize,
      initialSearchAfter,
      rangeFrom,
    );

    while (true) {
      const result = await currentPromise;
      if (!result) break;

      const isLast = result.events.length < result.requestedSize;

      const nextPromise = isLast
        ? Promise.resolve(null)
        : this.fetchWithFallback(this.effectiveBatchSize, result.sortValues, rangeFrom);

      yield result;

      if (isLast) break;
      currentPromise = nextPromise;
    }
  }

  async getStats(cursor?: Cursor | null): Promise<EsStats> {
    const rangeFrom = cursor?.lastEventTimestamp ?? undefined;
    const field = this.statsField;
    const baseQuery = this.buildQuery(rangeFrom);

    return this.withRetry("getStats", async () => {
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
    });
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

      const agg = await this.withRetry("discoverAggregates", async () => {
        const response = await this.client.search({
          index: this.options.index,
          body: {
            size: 0,
            query,
            aggs: { discovery: compositeAgg },
          },
        });

        return (response.aggregations as Record<string, unknown>)
          ?.discovery as
          | {
              buckets: Array<{ key: { tenant_id: string; agg_id: string } }>;
              after_key?: Record<string, unknown>;
            }
          | undefined;
      });

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
   * Paginates via search_after so aggregates with more than one page of
   * events are returned in full.
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

    return this.paginateSearch(filters, "fetchAggregateEvents");
  }

  /**
   * Fetch all events for multiple aggregates, grouped by tenant.
   *
   * Runs one paginated query per tenant, each scoped with a single
   * `term: tenantId` plus a `terms: aggregateIds` clause for that tenant's
   * IDs. This is required for correctness: a single combined query using
   * `terms` on both fields would also match foreign (tenantA, aggregateB)
   * combinations and leak them into the wrong groups.
   *
   * Per-tenant queries run sequentially to keep ES load predictable —
   * search_after pagination already handles large result sets internally.
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

    if (aggregates.length === 0) return new Map();

    // Group aggregate IDs by tenant so each ES query is tenant-scoped.
    const byTenant = new Map<string, Set<string>>();
    for (const { tenantId, aggregateId } of aggregates) {
      let set = byTenant.get(tenantId);
      if (!set) {
        set = new Set();
        byTenant.set(tenantId, set);
      }
      set.add(aggregateId);
    }

    const grouped = new Map<string, EsHit[]>();

    for (const [tenantId, aggregateIdSet] of byTenant) {
      const aggregateIds = [...aggregateIdSet];
      if (aggregateIds.length === 0) continue;

      const filters: Record<string, unknown>[] = [
        { term: { [tenantIdField]: tenantId } },
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

      const tenantHits = await this.paginateSearch(
        filters,
        "fetchBulkAggregateEvents",
      );

      for (const hit of tenantHits) {
        const aggregateId = (hit as Record<string, unknown>)[field] as string;
        const key = `${tenantId}:${aggregateId}`;
        let events = grouped.get(key);
        if (!events) {
          events = [];
          grouped.set(key, events);
        }
        events.push(hit);
      }
    }

    return grouped;
  }

  /**
   * Run a search_after-paginated ES query and return every matching hit.
   * Caller supplies the fully-built filter list; this helper handles the
   * page loop, retries, and source flattening.
   */
  private async paginateSearch(
    filters: Record<string, unknown>[],
    opName: string,
  ): Promise<EsHit[]> {
    const query =
      filters.length === 1 ? filters[0]! : { bool: { must: filters } };

    const PAGE_SIZE = 10_000;
    const allHits: EsHit[] = [];
    let searchAfter: unknown[] | undefined;

    while (true) {
      const currentSearchAfter = searchAfter;
      const hits = await this.withRetry(opName, async () => {
        const response = await this.client.search<Record<string, unknown>>({
          index: this.options.index,
          body: {
            size: PAGE_SIZE,
            sort: this.options.sort,
            query,
            ...(currentSearchAfter ? { search_after: currentSearchAfter } : {}),
          },
        });
        return response.hits.hits;
      });

      if (hits.length === 0) break;

      for (const hit of hits) {
        allHits.push({
          _id: hit._id!,
          ...(hit._source as Record<string, unknown>),
        });
      }

      if (hits.length < PAGE_SIZE) break;
      // Shallow-copy to break reference chain to full ES response
      searchAfter = [...(hits[hits.length - 1]!.sort as unknown[])];
    }

    return allHits;
  }

  private buildRangeQuery(from: number, to: number): Record<string, unknown> {
    const filters: Record<string, unknown>[] = [
      { range: { [this.timestampField]: { gte: Math.max(from, MIN_TIMESTAMP_MS), lt: to } } },
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

  /**
   * Find the next smaller batch size from the fallback list.
   * For content-too-large errors, skips to half the current size
   * since nearby sizes will also be too large.
   */
  private nextSmallerBatchSize(current: number, contentTooLarge = false): number | null {
    const target = contentTooLarge ? Math.floor(current / 2) : current - 1;
    for (const size of FALLBACK_BATCH_SIZES) {
      if (size <= target) return size;
    }
    return null;
  }

  /**
   * Fetch a batch from ES with adaptive retry.
   *
   * Three failure modes handled in a single loop:
   *
   * 1. **Content-too-large** (response > V8 string limit): halve batch size
   *    immediately, no backoff.
   *
   * 2. **Shard crash** (`no_shard_available`): likely a single toxic document
   *    that's too large for ES to serialize.  Wait for ES recovery, drop to
   *    batch size 1 to isolate it.  If size 1 also crashes the shard, fetch
   *    the doc's metadata with `_source: false` (tiny response), record the
   *    doc ID, advance past it, and continue.
   *
   * 3. **Other transient errors** (timeout, connection refused, etc.):
   *    exponential backoff, retry at same size.  After MAX_BACKOFF_ATTEMPTS
   *    consecutive failures at one size, reduce size and reset backoff.
   */
  private async fetchWithFallback(
    batchSize: number,
    searchAfter: unknown[] | undefined,
    rangeFrom?: number,
  ): Promise<EsBatch | null> {
    let currentSize = batchSize;
    let currentSearchAfter = searchAfter;
    let consecutiveTransient = 0;

    // Safety limit to prevent infinite loops.
    const maxTotalAttempts = MAX_BACKOFF_ATTEMPTS * (FALLBACK_BATCH_SIZES.length + 2);
    let totalAttempts = 0;

    while (totalAttempts < maxTotalAttempts) {
      totalAttempts++;

      // Backoff before retry on transient failures
      if (consecutiveTransient > 0) {
        const delaySec = Math.min(10 * 2 ** (consecutiveTransient - 1), 120);
        this.logger.info(
          `Backing off ${delaySec}s before retry (attempt ${consecutiveTransient}/${MAX_BACKOFF_ATTEMPTS}, batch=${currentSize})`,
        );
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }

      try {
        const result = await this.fetchBatch(currentSize, currentSearchAfter, rangeFrom);

        // Success — adapt effective batch size
        if (currentSize < this.effectiveBatchSize) {
          this.logger.info("Reducing effective batch size", {
            from: this.effectiveBatchSize,
            to: currentSize,
          });
          this.effectiveBatchSize = currentSize;
        } else if (currentSize < this.maxSafeSize) {
          // Gradually recover toward max safe size (capped after shard crashes)
          const recovered = Math.min(currentSize * 2, this.maxSafeSize);
          if (recovered !== this.effectiveBatchSize) {
            this.logger.info("Recovering batch size", {
              from: this.effectiveBatchSize,
              to: recovered,
            });
            this.effectiveBatchSize = recovered;
          }
        } else if (this.maxSafeSize < this.config.batchSize) {
          // At the safe ceiling — slowly raise it back toward the configured size.
          // Uses +50% steps (slower than the 2x recovery for effectiveBatchSize)
          // so we don't immediately jump back into the crash zone.
          const newCap = Math.min(
            Math.ceil(this.maxSafeSize * 1.5),
            this.config.batchSize,
          );
          this.logger.info("Raising safe batch size ceiling", {
            from: this.maxSafeSize,
            to: newCap,
          });
          this.maxSafeSize = newCap;
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // ── Content too large ──
        if (isContentTooLargeError(msg)) {
          const nextSize = this.nextSmallerBatchSize(currentSize, true);
          if (nextSize === null) {
            throw new Error(
              `ES response too large even at batch size 1: ${msg}`,
            );
          }
          this.logger.warn("Response too large, reducing batch size", {
            from: currentSize,
            to: nextSize,
            error: msg,
          });
          currentSize = nextSize;
          consecutiveTransient = 0;
          continue;
        }

        // ── Shard crash — likely a toxic document ──
        if (isShardCrashError(msg)) {
          if (currentSize <= 1) {
            // Already at size 1 — this single doc is crashing ES.
            // Wait for recovery, then skip past it using _source: false.
            this.logger.warn(
              "Toxic document crashed ES at batch size 1 — waiting for recovery to skip it",
            );
            await this.waitForEsRecovery();

            const skipped = await this.peekNextDocSortValues(
              currentSearchAfter,
              rangeFrom,
            );
            if (!skipped) return null; // no more docs

            this.logger.warn("SKIPPING TOXIC DOCUMENT", {
              docId: skipped.docId,
              sortValues: skipped.sortValues,
            });
            this.skippedDocIds.push(skipped.docId);

            try {
              await appendFile(
                "./skipped-toxic-docs.log",
                `${new Date().toISOString()} ${skipped.docId} sortValues=${JSON.stringify(skipped.sortValues)}\n`,
              );
            } catch {
              // best-effort file logging
            }

            // Advance past the toxic doc and continue
            currentSearchAfter = skipped.sortValues;
            consecutiveTransient = 0;
            continue;
          }

          // Batch > 1 — wait for recovery, then go to size 1 to isolate.
          // Cap future recovery at half the crashing size so we don't
          // grow back into the same crash.
          const newCap = Math.max(1, Math.floor(currentSize / 2));
          this.logger.warn(
            "Shard crash — waiting for ES recovery, then switching to size 1",
            { batchSize: currentSize, maxSafeSize: newCap },
          );
          this.maxSafeSize = Math.min(this.maxSafeSize, newCap);
          await this.waitForEsRecovery();
          currentSize = 1;
          this.effectiveBatchSize = 1;
          consecutiveTransient = 0;
          continue;
        }

        // ── Other transient errors ──
        if (isTransientEsError(msg)) {
          consecutiveTransient++;

          if (consecutiveTransient > MAX_BACKOFF_ATTEMPTS) {
            const nextSize = this.nextSmallerBatchSize(currentSize);
            if (nextSize === null) {
              throw new Error(
                `ES transient errors persist at batch size ${currentSize} after ${MAX_BACKOFF_ATTEMPTS} retries: ${msg}`,
              );
            }
            this.logger.warn(
              "Exhausted transient retries at this size, reducing batch size",
              { from: currentSize, to: nextSize },
            );
            currentSize = nextSize;
            consecutiveTransient = 0;
          } else {
            this.logger.warn("Transient ES error, will back off", {
              batchSize: currentSize,
              error: msg,
              attempt: consecutiveTransient,
            });
          }
          continue;
        }

        // ── Unknown / non-retryable error ──
        const nextSize = this.nextSmallerBatchSize(currentSize);
        if (nextSize === null) {
          throw new Error(`ES fetch failed at batch size ${currentSize}: ${msg}`);
        }
        this.logger.warn("Batch fetch failed, trying smaller size", {
          from: currentSize,
          to: nextSize,
          error: msg,
        });
        currentSize = nextSize;
        consecutiveTransient = 0;
        continue;
      }
    }

    throw new Error(
      `ES fetch failed after ${totalAttempts} total attempts (final batch size: ${currentSize})`,
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
    // Shallow-copy sort values to break the reference chain back to the
    // full ES response object — prevents the entire response from being
    // retained in memory via sortValues.
    const sortValues = [...(lastHit.sort as unknown[])];

    return { events, sortValues, requestedSize: size };
  }
}
