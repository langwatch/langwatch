/**
 * The list sidebar's facet discovery: one cached, tenant-scoped pass over the facet registry that
 * batches what shares a scan and runs the rest alone. Cold reads answer `pending` and hydrate in
 * the background, so no viewer waits on the full ClickHouse fan-out.
 */

import { ownProjectIdReadBy, readScopeKeyOf } from "@langwatch/authorization";
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

import type {
  FacetCatalog,
  FacetDefinition,
} from "#features/facet/rules/trace-facet-registry.rules";

import { settleCapped } from "../features/facet/rules/facet-read-concurrency.rules.ts";
import {
  isDeferredFacet,
  isExpressionCategorical,
  selectFacetsToRead,
} from "../features/facet/rules/trace-facet-classification.rules.ts";
import type { FacetFilterResolver } from "../features/facet/rules/trace-facet-filter.rules.ts";
import { TraceFacetDescriptorService } from "../features/facet/services/trace-facet-descriptor.service.ts";
import type { TraceTopicNamingService } from "../features/topic/services/trace-topic-naming.service.ts";
import type { TraceFilterWhere } from "../rules/trace-filter-hidden-origins.rules.ts";
import {
  discoverCacheKey,
  discoverPassKey,
  snapToWindowPreset,
  type DiscoverParams,
} from "../rules/trace-list-cache-key.rules.ts";
import {
  TraceDiscoverTaskService,
  type BatchedRegistrySlots,
  type DiscoverTask,
  type FacetFilters,
  type Outcome,
} from "./trace-discover-task.service.ts";
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

/** ClickHouse statements one pass runs at once; the rest of its reads wait their turn. */
const DISCOVER_PASS_MAX_CONCURRENT_STATEMENTS = 4;

/** How long a pass that failed holds off the next one for its key. */
const DISCOVER_PASS_FAILURE_COOLDOWN_MS = 30_000;

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

/** A deferred facet as discovery lists it: present, its values left for a keyed read. */
function deferredDescriptor(def: FacetDefinition & { kind: "categorical" }): FacetDescriptor {
  return {
    key: def.key,
    kind: "categorical",
    label: def.label,
    group: def.group,
    topValues: [],
    totalDistinct: 0,
    deferred: true,
  };
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

  /** Per-pod: the pass keys with a pass running, and when a failed one may run again. */
  private readonly discoverRefreshing = new Set<string>();
  private readonly discoverFailedUntil = new Map<string, number>();

  async getDiscover(params: DiscoverParams): Promise<DiscoverResult> {
    // Snap the requested window to a canonical preset BEFORE the cache
    // lookup so two users on the same tenant + window share a slot even
    // when their (from, to) timestamps differ by sub-minute drift. The
    // computeDiscover call below also uses the snapped range so cache
    // content always matches its key.
    const snapped = snapToWindowPreset(params.timeRange);
    const snappedParams: DiscoverParams = {
      authorization: params.authorization,
      timeRange: { from: snapped.from, to: snapped.to },
    };
    const cacheKey = discoverCacheKey({ authorization: params.authorization, snapped });
    const passKey = discoverPassKey({ authorization: params.authorization, snapped });
    const lookup = await DISCOVER_CACHE.get(cacheKey);

    if (lookup.kind === "hit") {
      const cached = lookup.value;
      // Stale-while-revalidate: hand back the cached payload and kick
      // off a background refresh when it's older than the 1-min
      // threshold. The refresh broadcasts `discover_updated` on
      // completion so any open browser invalidates and re-reads from
      // the now-warm cache.
      if (nowInstant().epochMilliseconds - cached.timestamp > DISCOVER_REFRESH_AFTER_MS) {
        this.refreshDiscoverInBackground({ params: snappedParams, cacheKey, passKey });
      }

      return { facets: cached.value, pending: false };
    }

    // Cold miss: return `pending: true` with an empty facet list and start an async
    // compute that hydrates the cache and SSE-broadcasts when done. Caller treats
    // `pending` as a loading signal so the curated skeleton renders instead of an
    // empty sidebar (~1-2s for the first viewer); `discover_updated` flips `pending`
    // to false without the user refreshing.
    this.refreshDiscoverInBackground({ params: snappedParams, cacheKey, passKey });

    return { facets: [], pending: true };
  }

  /**
   * Every registry facet counted under the active query in the list's window,
   * uncached and without the attribute keys (ADR-139); `facetKeys` narrows it
   * to those facets, the one way a deferred facet's values are counted.
   */
  getFilteredFacets({
    params,
    filterFor,
    facetKeys,
  }: {
    params: DiscoverParams;
    filterFor: FacetFilterResolver;
    facetKeys?: readonly string[];
  }): Promise<FacetDescriptor[]> {
    return this.computeFacets({
      params,
      filterFor,
      includeDynamicKeys: false,
      ...(facetKeys ? { facetKeys } : {}),
    });
  }

  /**
   * Deferred facets counted unfiltered over the snapped discovery window, kept
   * as long as a discovery payload stays fresh. A count missing a key is not kept.
   */
  getDeferredCounts({
    params,
    facetKeys,
  }: {
    params: DiscoverParams;
    facetKeys: readonly string[];
  }): Promise<FacetDescriptor[]> {
    const snapped = snapToWindowPreset(params.timeRange);
    const key = JSON.stringify([
      discoverCacheKey({ authorization: params.authorization, snapped }),
      facetKeys,
    ]);
    const running = this.deferredCounting.get(key);
    if (running) return running;

    const run = this.countDeferred({
      params: { authorization: params.authorization, timeRange: snapped },
      facetKeys,
      key,
    }).finally(() => this.deferredCounting.delete(key));
    this.deferredCounting.set(key, run);
    return run;
  }

  private readonly deferredCounting = new Map<string, Promise<FacetDescriptor[]>>();
  private readonly deferredCounts =
    TraceTtlCacheService.create<FacetDescriptor[]>(DISCOVER_REFRESH_AFTER_MS);

  private async countDeferred({
    params,
    facetKeys,
    key,
  }: {
    params: DiscoverParams;
    facetKeys: readonly string[];
    key: string;
  }): Promise<FacetDescriptor[]> {
    const lookup = await this.deferredCounts.get(key);
    if (lookup.kind === "hit") return lookup.value;

    const counted = await this.getFilteredFacets({
      params: { authorization: params.authorization, timeRange: params.timeRange },
      filterFor: () => undefined,
      facetKeys,
    });
    if (facetKeys.every((facetKey) => counted.some((facet) => facet.key === facetKey))) {
      await this.deferredCounts.set(key, counted);
    }
    return counted;
  }

  private refreshDiscoverInBackground({
    params,
    cacheKey,
    passKey,
  }: {
    params: DiscoverParams;
    cacheKey: string;
    passKey: string;
  }): void {
    // One pass per key in this process: a live window's cache key rolls every bucket, and a new
    // bucket must not start a second pass beside the one still reading, nor right after one failed.
    const now = nowInstant().epochMilliseconds;
    if (
      this.discoverRefreshing.has(passKey) ||
      (this.discoverFailedUntil.get(passKey) ?? 0) > now
    ) {
      return;
    }

    this.discoverRefreshing.add(passKey);
    this.discoverFailedUntil.delete(passKey);

    void (async () => {
      try {
        const fresh = await this.computeDiscover(params);
        await DISCOVER_CACHE.set(cacheKey, {
          value: fresh,
          timestamp: nowInstant().epochMilliseconds,
        });
        // SSE push to any browser subscribed for this tenant; the client refetches via tRPC and
        // hits the warm cache. Throws are swallowed: the cache write already succeeded.
        // The channel lives under the proof's own project; on an aggregate that is the aggregate.
        const ownProject = ownProjectIdReadBy(params.authorization);
        try {
          await this.updates.publishProjectEvent({
            projectId: ownProject,
            channel: "discover_updated",
            event: JSON.stringify({
              event: "discover_updated",
              tenantId: ownProject,
              timestamp: nowInstant().epochMilliseconds,
            }),
          });
        } catch (broadcastErr) {
          discoverLogger.warn(
            {
              scope: readScopeKeyOf(params.authorization),
              cacheKey,
              error: broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr),
            },
            "discover_updated broadcast failed; clients will see new payload on next read",
          );
        }
      } catch (err) {
        this.discoverFailedUntil.set(
          passKey,
          nowInstant().epochMilliseconds + DISCOVER_PASS_FAILURE_COOLDOWN_MS,
        );
        discoverLogger.warn(
          {
            cacheKey,
            error: err instanceof Error ? err.message : String(err),
          },
          "Background discover refresh failed; cached value still served",
        );
      } finally {
        this.discoverRefreshing.delete(passKey);
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
    facetKeys,
  }: {
    params: DiscoverParams;
    filterFor: FacetFilterResolver;
    includeDynamicKeys: boolean;
    facetKeys?: readonly string[];
  }): Promise<FacetDescriptor[]> {
    const filters = facetFilters(filterFor);
    const selected = selectFacetsToRead({
      registry: this.facets.registry,
      ...(facetKeys ? { facetKeys } : {}),
    });
    const { batched, standalone } = partitionFacetRegistry({
      registry: selected,
      filters,
      includeDynamicKeys,
    });
    const taskTimings: { label: string; durationMs: number }[] = [];
    const startedAt = nowInstant().epochMilliseconds;
    const timed = (task: DiscoverTask): DiscoverTask => ({
      ...task,
      run: () => {
        const t0 = nowInstant().epochMilliseconds;

        return task.run().finally(() => {
          taskTimings.push({ label: task.label, durationMs: nowInstant().epochMilliseconds - t0 });
        });
      },
    });

    const tasks = [
      ...this.tasks.batchTasks(params, batched),
      ...this.tasks.standaloneTasks({ params, standalone, filters }),
      ...this.tasks.discreteTasks({ params, registry: selected, filters }),
    ].map(timed);

    const settled = await settleCapped(tasks, DISCOVER_PASS_MAX_CONCURRENT_STATEMENTS);
    this.logSlowDiscover({
      params,
      totalMs: nowInstant().epochMilliseconds - startedAt,
      taskCount: tasks.length,
      taskTimings,
    });

    const { batchBySlot, standaloneByKey, discreteByKey } = collectDiscoverOutcomes(settled);

    // Assemble in registry order so the sidebar's group ordering is preserved.
    const facets: FacetDescriptor[] = [];
    const read = new Set(selected);
    for (const def of this.facets.registry) {
      if (!read.has(def)) {
        if (!facetKeys && isDeferredFacet(def)) facets.push(deferredDescriptor(def));
        continue;
      }
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
      {
        scope: readScopeKeyOf(params.authorization),
        totalMs,
        breakdown: taskTimings.slice(0, 20),
        taskCount,
      },
      "Discover wall-clock exceeded 1.5s — per-task breakdown",
    );
  }
}
