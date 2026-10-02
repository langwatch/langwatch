/**
 * The list sidebar's facet discovery: one cached, tenant-scoped pass over the facet registry that
 * batches what shares a scan and runs the rest alone. Cold reads answer `pending` and hydrate in
 * the background, so no viewer waits on the full ClickHouse fan-out.
 */

import { createLogger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";
import { nowInstant } from "@langwatch/time";
import type {
  BatchedFacetResult,
  DiscoverResult,
  DiscreteFacetResult,
  FacetDescriptor,
  TraceListRead,
} from "@langwatch/trace-contract";

import type { FacetCatalog, FacetDefinition } from "#rules/trace-facet-registry.rules";

import { isExpressionCategorical } from "../rules/trace-facet-classification.rules.ts";
import type { FacetFilterResolver } from "../rules/trace-facet-filter.rules.ts";
import type { TraceFilterWhere } from "../rules/trace-filter-hidden-origins.rules.ts";
import {
  discoverCacheKey,
  snapToWindowPreset,
  type DiscoverParams,
} from "../rules/trace-list-cache-key.rules.ts";
import {
  TraceDiscoverTaskService,
  type BatchedRegistrySlots,
  type FacetFilters,
  type Outcome,
} from "./trace-discover-task.service.ts";
import { TraceFacetDescriptorService } from "./trace-facet-descriptor.service.ts";
import type { TraceTopicNamingService } from "./trace-topic-naming.service.ts";
import { TraceTtlCacheService } from "./trace-ttl-cache.service.ts";

/**
 * Stale-while-revalidate cache for the full discover payload. The table view fires `discover` on
 * every time-range change for every viewer, so caching by tenant and bucketed window collapses
 * concurrent viewers onto one ClickHouse run. Keys are tenant-scoped, as `discoverCacheKey` shows.
 */
const DISCOVER_TTL_MS = 30 * 60 * 1000;
/**
 * Refresh threshold, set so active viewers see fresh facet values within a minute of new traces
 * arriving. The heavy ClickHouse cost is still paid at most once per tenant per refresh window,
 * and the SSE push propagates the new payload to any open browser without polling.
 */
const DISCOVER_REFRESH_AFTER_MS = 60 * 1000;

interface CachedDiscover {
  value: FacetDescriptor[];
  timestamp: number;
}

const DISCOVER_CACHE = TraceTtlCacheService.create<CachedDiscover>(DISCOVER_TTL_MS);

/**
 * Refresh lock — a separate cache because the lease needs a short TTL so a
 * crashed refresher self-recovers quickly, while the value cache keeps a long one. Reusing the
 * value cache for locks would mean half an hour of stale data after a refresher crash.
 */
const DISCOVER_REFRESH_LOCK_CACHE = TraceTtlCacheService.create<number>(60_000);

const discoverLogger = createLogger("langwatch:app-layer:traces:trace-list-discover");

function facetFilters(filterFor: FacetFilterResolver): FacetFilters {
  const byKey = new Map<string, TraceFilterWhere | undefined>();
  const slotIds = new Map<TraceFilterWhere | undefined, number>();
  const of = (def: FacetDefinition): TraceFilterWhere | undefined => {
    if (!byKey.has(def.key)) {
      byKey.set(def.key, filterFor({ key: def.key, table: def.table }));
    }

    return byKey.get(def.key);
  };

  return {
    of,
    slotKeyOf: (def) => {
      const filter = of(def);
      if (!slotIds.has(filter)) slotIds.set(filter, slotIds.size);

      return `${def.table}#${slotIds.get(filter)}`;
    },
  };
}

/**
 * Splits the facet registry into the simple-expression facets that share one batched scan per
 * table and the arrayJoin, queryBuilder and dynamic-keys facets that must run alone.
 */
function partitionFacetRegistry({
  registry,
  filters,
  includeDynamicKeys,
}: {
  registry: readonly FacetDefinition[];
  filters: FacetFilters;
  includeDynamicKeys: boolean;
}): {
  batched: BatchedRegistrySlots;
  standalone: FacetDefinition[];
} {
  const batched: BatchedRegistrySlots = new Map();
  const standalone: FacetDefinition[] = [];
  const slotFor = (def: FacetDefinition) => {
    const key = filters.slotKeyOf(def);
    const slot = batched.get(key) ?? {
      table: def.table,
      filterWhere: filters.of(def),
      categoricals: [],
      ranges: [],
    };
    batched.set(key, slot);

    return slot;
  };

  for (const def of registry) {
    const isGroupableCategorical =
      def.kind === "categorical" &&
      isExpressionCategorical(def) &&
      !def.expression.includes("arrayJoin");
    if (def.kind === "range") {
      slotFor(def).ranges.push(def);
    } else if (isGroupableCategorical) {
      slotFor(def).categoricals.push(def);
    } else if (def.kind !== "dynamic_keys" || includeDynamicKeys) {
      standalone.push(def);
    }
  }

  return { batched, standalone };
}

/** Sorts settled task results into their three indexes; a failed task omits its facets. */
function collectDiscoverOutcomes(settled: PromiseSettledResult<Outcome>[]): {
  batchBySlot: Map<string, BatchedFacetResult>;
  standaloneByKey: Map<string, FacetDescriptor>;
  discreteByKey: Map<string, DiscreteFacetResult>;
} {
  const batchBySlot = new Map<string, BatchedFacetResult>();
  const standaloneByKey = new Map<string, FacetDescriptor>();
  const discreteByKey = new Map<string, DiscreteFacetResult>();

  for (const result of settled) {
    if (result.status === "rejected") {
      discoverLogger.warn(
        { error: String(result.reason) },
        "Facet discovery query failed, omitting affected facets",
      );
      continue;
    }

    if (result.value.kind === "batch") {
      batchBySlot.set(result.value.slotKey, result.value.result);
    } else if (result.value.kind === "discrete") {
      discreteByKey.set(result.value.key, result.value.result);
    } else {
      standaloneByKey.set(result.value.key, result.value.descriptor);
    }
  }

  return { batchBySlot, standaloneByKey, discreteByKey };
}

export class TraceDiscoverService {
  private readonly descriptors: TraceFacetDescriptorService;
  private readonly tasks: TraceDiscoverTaskService;
  private readonly facets: FacetCatalog;
  private readonly updates: Pick<PresenceApi, "publishProjectEvent">;

  private constructor(deps: {
    repository: TraceListRead;
    descriptors: TraceFacetDescriptorService;
    facets: FacetCatalog;
    updates: Pick<PresenceApi, "publishProjectEvent">;
  }) {
    this.descriptors = deps.descriptors;
    this.tasks = TraceDiscoverTaskService.create({
      repository: deps.repository,
      descriptors: deps.descriptors,
      facets: deps.facets,
    });
    this.facets = deps.facets;
    this.updates = deps.updates;
  }

  static create({
    repository,
    topicNaming,
    facets,
    updates,
  }: {
    repository: TraceListRead;
    topicNaming: TraceTopicNamingService;
    facets: FacetCatalog;
    /** Where a finished background refresh tells the tenant's tabs to refetch. */
    updates: Pick<PresenceApi, "publishProjectEvent">;
  }): TraceDiscoverService {
    return new TraceDiscoverService({
      repository,
      descriptors: TraceFacetDescriptorService.create({ repository, topicNaming, facets }),
      facets,
      updates,
    });
  }

  /** Per-pod dedup of in-flight background refreshes. */
  private readonly discoverRefreshing = new Set<string>();

  async getDiscover(params: DiscoverParams): Promise<DiscoverResult> {
    // Snap the requested window to a canonical preset BEFORE the cache
    // lookup so two users on the same tenant + window share a slot even
    // when their (from, to) timestamps differ by sub-minute drift. The
    // computeDiscover call below also uses the snapped range so cache
    // content always matches its key.
    const snapped = snapToWindowPreset(params.timeRange);
    const snappedParams: DiscoverParams = {
      tenantId: params.tenantId,
      timeRange: { from: snapped.from, to: snapped.to },
    };
    const cacheKey = discoverCacheKey(params.tenantId, snapped);
    const lookup = await DISCOVER_CACHE.get(cacheKey);

    if (lookup.kind === "hit") {
      const cached = lookup.value;
      // Stale-while-revalidate: hand back the cached payload and kick
      // off a background refresh when it's older than the 1-min
      // threshold. The refresh broadcasts `discover_updated` on
      // completion so any open browser invalidates and re-reads from
      // the now-warm cache.
      if (nowInstant().epochMilliseconds - cached.timestamp > DISCOVER_REFRESH_AFTER_MS) {
        this.refreshDiscoverInBackground(snappedParams, cacheKey);
      }

      return { facets: cached.value, pending: false };
    }

    // Cold miss: return `pending: true` with an empty facet list and start an async
    // compute that hydrates the cache and SSE-broadcasts when done. Caller treats
    // `pending` as a loading signal so the curated skeleton renders instead of an
    // empty sidebar (~1-2s for the first viewer); `discover_updated` flips `pending`
    // to false without the user refreshing.
    this.refreshDiscoverInBackground(snappedParams, cacheKey);

    return { facets: [], pending: true };
  }

  /**
   * Every registry facet counted under the active query, in the window the list
   * reads: uncached, and without the attribute keys, which are a vocabulary the
   * sidebar keeps from the cached discovery. ADR-139.
   */
  getFilteredFacets({
    params,
    filterFor,
  }: {
    params: DiscoverParams;
    filterFor: FacetFilterResolver;
  }): Promise<FacetDescriptor[]> {
    return this.computeFacets({ params, filterFor, includeDynamicKeys: false });
  }

  private refreshDiscoverInBackground(params: DiscoverParams, cacheKey: string): void {
    // Avoid stacking redundant background refreshes on the same key inside this process;
    // the lock cache holds the claim for one refresh window.
    if (this.discoverRefreshing.has(cacheKey)) {
      return;
    }

    this.discoverRefreshing.add(cacheKey);

    void (async () => {
      try {
        // 60s lease is enough for any single compute (5-8s on the slowest tenants); a lost
        // claim means a refresh is already running and its write hydrates the value cache.
        const claimed = await DISCOVER_REFRESH_LOCK_CACHE.claim(
          cacheKey,
          nowInstant().epochMilliseconds,
        );
        if (!claimed) {
          return;
        }

        const fresh = await this.computeDiscover(params);
        await DISCOVER_CACHE.set(cacheKey, {
          value: fresh,
          timestamp: nowInstant().epochMilliseconds,
        });
        // SSE push to any browser subscribed for this tenant; the client refetches via tRPC and
        // hits the warm cache. Throws are swallowed: the cache write already succeeded.
        try {
          await this.updates.publishProjectEvent({
            projectId: params.tenantId,
            channel: "discover_updated",
            event: JSON.stringify({
              event: "discover_updated",
              tenantId: params.tenantId,
              timestamp: nowInstant().epochMilliseconds,
            }),
          });
        } catch (broadcastErr) {
          discoverLogger.warn(
            {
              tenantId: params.tenantId,
              cacheKey,
              error: broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr),
            },
            "discover_updated broadcast failed; clients will see new payload on next read",
          );
        }
      } catch (err) {
        discoverLogger.warn(
          {
            cacheKey,
            error: err instanceof Error ? err.message : String(err),
          },
          "Background discover refresh failed; cached value still served",
        );
      } finally {
        this.discoverRefreshing.delete(cacheKey);
      }
    })();
  }

  private computeDiscover(params: DiscoverParams): Promise<FacetDescriptor[]> {
    return this.computeFacets({ params, filterFor: () => undefined, includeDynamicKeys: true });
  }

  /**
   * Every registry facet read over the window, each under the predicate
   * `filterFor` answers for it (none for discover). Facets sharing a table and
   * a predicate share one batched scan; the rest run on their own.
   */
  private async computeFacets({
    params,
    filterFor,
    includeDynamicKeys,
  }: {
    params: DiscoverParams;
    filterFor: FacetFilterResolver;
    includeDynamicKeys: boolean;
  }): Promise<FacetDescriptor[]> {
    const filters = facetFilters(filterFor);
    const { batched, standalone } = partitionFacetRegistry({
      registry: this.facets.registry,
      filters,
      includeDynamicKeys,
    });
    const taskTimings: { label: string; durationMs: number }[] = [];
    const startedAt = nowInstant().epochMilliseconds;
    const wrap = <T>(label: string, p: Promise<T>): Promise<T> => {
      const t0 = nowInstant().epochMilliseconds;

      return p.finally(() => {
        taskTimings.push({ label, durationMs: nowInstant().epochMilliseconds - t0 });
      });
    };

    const tasks: Promise<Outcome>[] = [
      ...this.tasks.batchTasks(params, batched, wrap),
      ...this.tasks.standaloneTasks({ params, standalone, filters, wrap }),
      ...this.tasks.discreteTasks(params, filters, wrap),
    ];

    const settled = await Promise.allSettled(tasks);
    this.logSlowDiscover({
      params,
      totalMs: nowInstant().epochMilliseconds - startedAt,
      taskCount: tasks.length,
      taskTimings,
    });

    const { batchBySlot, standaloneByKey, discreteByKey } = collectDiscoverOutcomes(settled);

    // Assemble in registry order so the sidebar's group ordering is preserved.
    const facets: FacetDescriptor[] = [];
    for (const def of this.facets.registry) {
      const descriptor = await this.descriptors.buildDescriptor({
        def,
        params,
        batch: batchBySlot.get(filters.slotKeyOf(def)),
        standaloneByKey,
        discreteByKey,
      });
      if (descriptor) {
        facets.push(descriptor);
      }
    }

    return facets;
  }

  private logSlowDiscover({
    params,
    totalMs,
    taskCount,
    taskTimings,
  }: {
    params: DiscoverParams;
    totalMs: number;
    taskCount: number;
    taskTimings: { label: string; durationMs: number }[];
  }): void {
    if (totalMs <= 1500) {
      return;
    }

    taskTimings.sort((a, b) => b.durationMs - a.durationMs);
    discoverLogger.info(
      { tenantId: params.tenantId, totalMs, breakdown: taskTimings.slice(0, 20), taskCount },
      "Discover wall-clock exceeded 1.5s — per-task breakdown",
    );
  }
}
