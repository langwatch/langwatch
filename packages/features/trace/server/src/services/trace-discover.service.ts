/**
 * The list sidebar's facet discovery: one cached, tenant-scoped pass over the facet registry that
 * batches what shares a scan and runs the rest alone. Cold reads answer `pending` and hydrate in
 * the background, so no viewer waits on the full ClickHouse fan-out.
 */

import { createLogger } from "@langwatch/observability";
import type {
  BatchedFacetResult,
  DiscoverResult,
  DiscreteFacetResult,
  FacetDescriptor,
  TraceListReadPort,
} from "@langwatch/trace-contract";
import type {
  ExpressionCategoricalDef,
  FacetDefinition,
  FacetTable,
  RangeFacetDef,
} from "@langwatch/trace-server";
import { ClickHouseFacetRegistryAdapter } from "@langwatch/trace-server";

import {
  discoverCacheKey,
  snapToWindowPreset,
  type DiscoverParams,
} from "../rules/trace-list-cache-key.rules";
import { isExpressionCategorical } from "../rules/trace-facet-classification.rules";
import { TtlCache } from "./trace-ttl-cache.service";
import type { TraceTopicNamingService } from "./trace-topic-naming.service";
import { TraceFacetDescriptorService } from "./trace-facet-descriptor.service";

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

const DISCOVER_CACHE = new TtlCache<CachedDiscover>(DISCOVER_TTL_MS, "tracesV2:discover:");

/**
 * Cross-pod refresh lock — a separate cache because the leadership lease needs a short TTL so a
 * crashed refresher self-recovers quickly, while the value cache keeps a long one. Reusing the
 * value cache for locks would mean half an hour of stale data after a refresher crash.
 */
const DISCOVER_REFRESH_LOCK_CACHE = new TtlCache<number>(60_000, "tracesV2:discover:refresh-lock:");

/**
 * Optional sink for "discover finished refreshing" pushes, registered once at bootstrap so the
 * service can fire and forget into the broadcast layer. A setter rather than a constructor
 * parameter, since the null repository and test factories do not want the dependency.
 */
export type DiscoverBroadcaster = (tenantId: string) => void;
let discoverBroadcaster: DiscoverBroadcaster | null = null;

const discoverLogger = createLogger("langwatch:app-layer:traces:trace-list-discover");

/** Top values fetched per categorical facet during discovery. */
const DISCOVER_TOP_N = 50;

/**
 * Distinct integer values fetched per `isDiscrete`-flagged facet. The exact distinct count comes
 * back regardless of this cap, so the sidebar can still fall back to the slider when a facet
 * exceeds its threshold.
 */
const DISCRETE_VALUE_LIMIT = 50;

type TaskTimer = <T>(label: string, p: Promise<T>) => Promise<T>;

type BatchedRegistrySlots = Map<
  FacetTable,
  { categoricals: ExpressionCategoricalDef[]; ranges: RangeFacetDef[] }
>;

type Outcome =
  | { kind: "batch"; table: FacetTable; result: BatchedFacetResult }
  | { kind: "standalone"; key: string; descriptor: FacetDescriptor }
  | { kind: "discrete"; key: string; result: DiscreteFacetResult };

/**
 * Splits the facet registry into the simple-expression facets that share one batched scan per
 * table and the arrayJoin, queryBuilder and dynamic-keys facets that must run alone.
 */
function partitionFacetRegistry(): {
  batched: BatchedRegistrySlots;
  standalone: FacetDefinition[];
} {
  const batched: BatchedRegistrySlots = new Map();
  const standalone: FacetDefinition[] = [];
  const slotFor = (table: FacetTable) => {
    const slot = batched.get(table) ?? { categoricals: [], ranges: [] };
    batched.set(table, slot);

    return slot;
  };

  for (const def of ClickHouseFacetRegistryAdapter.FACET_REGISTRY) {
    if (def.kind === "range") {
      slotFor(def.table).ranges.push(def);
    } else if (
      def.kind === "categorical" &&
      isExpressionCategorical(def) &&
      !def.expression.includes("arrayJoin")
    ) {
      slotFor(def.table).categoricals.push(def);
    } else {
      standalone.push(def);
    }
  }

  return { batched, standalone };
}

/** Sorts settled task results into their three indexes; a failed task omits its facets. */
function collectDiscoverOutcomes(settled: PromiseSettledResult<Outcome>[]): {
  batchByTable: Map<FacetTable, BatchedFacetResult>;
  standaloneByKey: Map<string, FacetDescriptor>;
  discreteByKey: Map<string, DiscreteFacetResult>;
} {
  const batchByTable = new Map<FacetTable, BatchedFacetResult>();
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
      batchByTable.set(result.value.table, result.value.result);
    } else if (result.value.kind === "discrete") {
      discreteByKey.set(result.value.key, result.value.result);
    } else {
      standaloneByKey.set(result.value.key, result.value.descriptor);
    }
  }

  return { batchByTable, standaloneByKey, discreteByKey };
}

export class TraceDiscoverService {
  private constructor(
    private readonly repository: TraceListReadPort,
    private readonly descriptors: TraceFacetDescriptorService,
  ) {}

  static create({
    repository,
    topicNaming,
  }: {
    repository: TraceListReadPort;
    topicNaming: TraceTopicNamingService;
  }): TraceDiscoverService {
    return new TraceDiscoverService(
      repository,
      TraceFacetDescriptorService.create({ repository, topicNaming }),
    );
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
    const cached = await DISCOVER_CACHE.tryGet(cacheKey);

    if (cached) {
      // Stale-while-revalidate: hand back the cached payload and kick
      // off a background refresh when it's older than the 1-min
      // threshold. The refresh broadcasts `discover_updated` on
      // completion so any open browser invalidates and re-reads from
      // the now-warm cache.
      if (Date.now() - cached.timestamp > DISCOVER_REFRESH_AFTER_MS) {
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

  private refreshDiscoverInBackground(params: DiscoverParams, cacheKey: string): void {
    // Per-pod dedup: avoid stacking redundant background refreshes on the same key
    // inside this process. Cross-pod dedup uses `DISCOVER_CACHE.claim()` (a Redis SET
    // NX EX leadership lease) so only one pod pays the compute cost per refresh window;
    // if we don't win the claim, another pod is already on it.
    if (this.discoverRefreshing.has(cacheKey)) {
      return;
    }

    this.discoverRefreshing.add(cacheKey);

    void (async () => {
      try {
        // 60s lease (dedicated lock cache) is enough for any single compute (5-8s on
        // the slowest tenants) and self-clears on pod crash. We claim once per refresh
        // attempt — if we lose the claim, another pod is already on it and its write
        // will hydrate the value cache for every reader.
        const claimed = await DISCOVER_REFRESH_LOCK_CACHE.claim(cacheKey, Date.now());
        if (!claimed) {
          return;
        }

        const fresh = await this.computeDiscover(params);
        await DISCOVER_CACHE.set(cacheKey, {
          value: fresh,
          timestamp: Date.now(),
        });
        // SSE push to any browser subscribed for this tenant. Empty
        // payload — the client refetches via tRPC and hits the warm
        // cache. We swallow throws because broadcast errors should
        // never bubble up into the user-facing path (the cache write
        // already succeeded).
        try {
          discoverBroadcaster?.(params.tenantId);
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

  private async computeDiscover(params: DiscoverParams): Promise<FacetDescriptor[]> {
    const { batched, standalone } = partitionFacetRegistry();
    const taskTimings: Array<{ label: string; durationMs: number }> = [];
    const startedAt = Date.now();
    const wrap = <T>(label: string, p: Promise<T>): Promise<T> => {
      const t0 = Date.now();

      return p.finally(() => {
        taskTimings.push({ label, durationMs: Date.now() - t0 });
      });
    };

    const tasks: Promise<Outcome>[] = [
      ...this.batchTasks(params, batched, wrap),
      ...this.standaloneTasks(params, standalone, wrap),
      ...this.discreteTasks(params, wrap),
    ];

    const settled = await Promise.allSettled(tasks);
    this.logSlowDiscover({
      params,
      totalMs: Date.now() - startedAt,
      taskCount: tasks.length,
      taskTimings,
    });

    const { batchByTable, standaloneByKey, discreteByKey } = collectDiscoverOutcomes(settled);

    // Assemble in registry order so the sidebar's group ordering is preserved.
    const facets: FacetDescriptor[] = [];
    for (const def of ClickHouseFacetRegistryAdapter.FACET_REGISTRY) {
      const descriptor = await this.descriptors.tryMaterializeDescriptor(
        def,
        params,
        batchByTable,
        standaloneByKey,
        discreteByKey,
      );
      if (descriptor) {
        facets.push(descriptor);
      }
    }

    return facets;
  }

  /** Simple-expression facets per table share one batched ClickHouse scan. */
  private batchTasks(
    params: DiscoverParams,
    batched: BatchedRegistrySlots,
    wrap: TaskTimer,
  ): Promise<Outcome>[] {
    return [...batched].map(([table, slot]) =>
      wrap(
        `batch:${table}`,
        this.repository
          .findBatchedFacets({
            tenantId: params.tenantId,
            timeRange: params.timeRange,
            table,
            timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[table],
            categoricalSpecs: slot.categoricals.map((d) => ({
              key: d.key,
              expression: d.expression,
            })),
            rangeSpecs: slot.ranges.map((d) => ({ key: d.key, expression: d.expression })),
            topN: DISCOVER_TOP_N,
          })
          .then((result): Outcome => ({ kind: "batch", table, result })),
      ),
    );
  }

  /** arrayJoin, queryBuilder and dynamic-keys facets cannot share a scan. */
  private standaloneTasks(
    params: DiscoverParams,
    standalone: FacetDefinition[],
    wrap: TaskTimer,
  ): Promise<Outcome>[] {
    return standalone.map((def) =>
      wrap(
        `standalone:${def.kind}:${def.key}`,
        (async (): Promise<Outcome> => {
          let descriptor: FacetDescriptor;
          switch (def.kind) {
            case "categorical":
              descriptor = await this.descriptors.discoverCategorical(def, params, DISCOVER_TOP_N);
              break;
            case "range":
              descriptor = await this.descriptors.discoverRange(def, params);
              break;
            case "dynamic_keys":
              descriptor = await this.descriptors.discoverDynamicKeys(def, params, DISCOVER_TOP_N);
              break;
          }

          return { kind: "standalone", key: def.key, descriptor };
        })(),
      ),
    );
  }

  /**
   * Distinct-value discovery for `isDiscrete`-flagged integer facets. Runs as its own GROUP BY per
   * facet, since the batched range pass only yields min and max.
   */
  private discreteTasks(params: DiscoverParams, wrap: TaskTimer): Promise<Outcome>[] {
    return ClickHouseFacetRegistryAdapter.FACET_REGISTRY.filter(
      (def): def is RangeFacetDef => def.kind === "range" && def.isDiscrete === true,
    ).map((def) =>
      wrap(
        `discrete:${def.key}`,
        this.repository
          .findDiscreteValues({
            tenantId: params.tenantId,
            timeRange: params.timeRange,
            table: def.table,
            timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[def.table],
            column: def.expression,
            limit: DISCRETE_VALUE_LIMIT,
          })
          .then((result): Outcome => ({ kind: "discrete", key: def.key, result })),
      ),
    );
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
    taskTimings: Array<{ label: string; durationMs: number }>;
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

  static setDiscoverBroadcaster(fn: DiscoverBroadcaster | null): void {
    discoverBroadcaster = fn;
  }
}
