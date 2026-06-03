import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { EvalSummary } from "~/server/app-layer/evaluations/types";
import type { TopicService } from "~/server/app-layer/topics/topic.service";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import type {
  ExpressionCategoricalDef,
  FacetDefinition,
  FacetTable,
  RangeFacetDef,
} from "./facet-registry";
import {
  deriveTraceStatus,
  TRACE_STATUS_CLICKHOUSE_EXPRESSION,
} from "./derive-trace-status";
import { FACET_REGISTRY, TABLE_TIME_COLUMNS } from "./facet-registry";
import type {
  BatchedFacetResult,
  CategoricalFacetResult,
  TraceListRepository,
  TraceListSort,
} from "./repositories/trace-list.repository";
import type { TraceSummaryData } from "./types";

export interface TraceListEvent {
  spanId: string;
  timestamp: number;
  name: string;
}

export interface TraceListItem {
  traceId: string;
  timestamp: number;
  name: string;
  serviceName: string;
  durationMs: number;
  totalCost: number;
  totalTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  models: string[];
  status: "ok" | "error" | "warning";
  spanCount: number;
  input: string | null;
  output: string | null;
  error: string | null;
  conversationId: string | null;
  userId: string | null;
  origin: string;
  tokensEstimated: boolean;
  ttft: number | null;
  traceName: string;
  rootSpanType: string | null;
  events: TraceListEvent[];
}

export interface TraceListPage {
  items: TraceListItem[];
  totalHits: number;
  evaluations: Record<string, EvalSummary[]>;
}

interface FacetCounts {
  origin: Record<string, number>;
  status: Record<string, number>;
  service: Record<string, number>;
  model: Record<string, number>;
  ranges: {
    tokens: { min: number; max: number };
    cost: { min: number; max: number };
    latency: { min: number; max: number };
  };
}

interface ListParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  sort: { columnId: string; direction: "asc" | "desc" };
  page: number;
  pageSize: number;
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

interface FacetParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

interface NewCountParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  since: number;
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

interface SuggestParams {
  tenantId: string;
  field: string;
  prefix: string;
  limit?: number;
}

interface DiscoverParams {
  tenantId: string;
  timeRange: { from: number; to: number };
}

interface FacetValuesParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  facetKey: string;
  prefix?: string;
  limit: number;
  offset: number;
}

/** Whitelist for attribute key chars — defends against SQL injection in dynamic Attributes lookup. */
const ATTRIBUTE_KEY_REGEX = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Stale-while-revalidate cache for facet value results.
 *
 * Strategy: return the cached value immediately on every hit, even if it's
 * older than the refresh threshold. When a value is older than the refresh
 * threshold, kick off a background recomputation that updates the cache for
 * the next hit. This gives instant responses always, with a soft staleness
 * bound of TTL_MS and an effective freshness of REFRESH_AFTER_MS once a key
 * is being read regularly.
 *
 * Why such a long TTL? The discover queries scan the *whole* tenant time
 * window (~125MB of `stored_spans` for `spanAttributeKeys` etc.) — paying
 * that cost on every request is what made the slow-query log light up.
 * Attribute key sets and top values turn over slowly, so a 30-min ceiling
 * with a 2-min background refresh is the right trade: the user almost
 * always gets a cached answer, and active sessions still see fresh data
 * within ~2 minutes of ingest. Cache keys include `tenantId`, so this is
 * tenant-isolated by construction.
 */
const FACET_VALUES_TTL_MS = 30 * 60 * 1000; // cache lives up to 30 minutes
const FACET_VALUES_REFRESH_AFTER_MS = 2 * 60 * 1000; // background refresh after 2 min

interface CachedFacetValues {
  value: FacetValuesResult;
  timestamp: number;
}

const FACET_VALUES_CACHE = new TtlCache<CachedFacetValues>(
  FACET_VALUES_TTL_MS,
  "tracesV2:facetValues:",
);

/**
 * SWR cache for the full discover() payload. The table view fires `discover`
 * on every time-range change for every viewer; caching by tenant + bucketed
 * window collapses concurrent viewers and rapid-refetches onto a single
 * ClickHouse run.
 *
 * TTL is generous (30 min) for the same reason as `FACET_VALUES_*`: the
 * underlying ClickHouse scans are ~125MB+ on busy tenants, the result
 * turns over slowly (top values + key sets), and the SWR pattern means
 * users still get a background refresh every ~2 min of actual reads.
 * Cache keys are tenant-scoped — see `discoverCacheKey`.
 */
const DISCOVER_TTL_MS = 30 * 60 * 1000;
/**
 * Refresh threshold dropped from 2 min to 1 min so active viewers see
 * fresh facet values within a minute of new traces arriving. The
 * heavy ClickHouse cost is still paid at most once per tenant per
 * refresh window (cross-pod `claim` + per-pod `discoverRefreshing`
 * Set both keep concurrent compute single-flight), and the SSE push
 * from `refreshDiscoverInBackground` propagates the new payload to
 * any open browser without that browser needing to poll.
 */
const DISCOVER_REFRESH_AFTER_MS = 60 * 1000;

interface CachedDiscover {
  value: FacetDescriptor[];
  timestamp: number;
}

const DISCOVER_CACHE = new TtlCache<CachedDiscover>(
  DISCOVER_TTL_MS,
  "tracesV2:discover:",
);

/**
 * Cross-pod refresh lock — separate cache because the leadership lease
 * needs a SHORT TTL (60s) so a crashed refresher self-recovers quickly,
 * while the value cache itself keeps a long TTL (30 min). If we reused
 * the value cache for locks the failure mode would be 30 min of stale
 * data after a refresher crash.
 */
const DISCOVER_REFRESH_LOCK_CACHE = new TtlCache<number>(
  60_000,
  "tracesV2:discover:refresh-lock:",
);

/**
 * Optional sink for "discover finished refreshing" SSE pushes. Set
 * once at app bootstrap via `setDiscoverBroadcaster` so the service
 * can fire-and-forget into the broadcast layer when a background
 * refresh lands a fresher payload in the shared cache. The setter
 * pattern avoids threading BroadcastService through the constructor
 * (which is shared with the null repo / test factories that don't
 * want the dependency); production callers register the live one.
 */
type DiscoverBroadcaster = (tenantId: string) => void;
let discoverBroadcaster: DiscoverBroadcaster | null = null;

export function setDiscoverBroadcaster(fn: DiscoverBroadcaster | null): void {
  discoverBroadcaster = fn;
}

/** Bucket size for live-range time params so the cache key stabilises across rapid refetches. */
const CACHE_TIME_BUCKET_MS = 60_000;

function bucketTime(ts: number): number {
  return Math.floor(ts / CACHE_TIME_BUCKET_MS) * CACHE_TIME_BUCKET_MS;
}

/**
 * Canonical window presets the cache snaps `discover` requests to. Two users
 * looking at "last hour" within seconds of each other previously paid the
 * full compute twice because their (from, to) timestamps differed by
 * sub-minute drift — even after the 1-min bucket on the boundaries, the
 * window spans were unique per render. Snapping arbitrary windows to the
 * nearest canonical preset means every viewer of "the last day" on a
 * given tenant hits the same cache slot.
 *
 * Ordered by ascending duration. Each entry is the bucket size that
 * windows shorter than `maxSpanMs` snap to.
 */
const DISCOVER_WINDOW_PRESETS: ReadonlyArray<{
  /** Window spans up to this size snap to `bucketMs`. */
  maxSpanMs: number;
  /** Bucket the `to` timestamp to a multiple of this size. */
  bucketMs: number;
  /** Stable label that goes into the cache key. */
  label: string;
}> = [
  { maxSpanMs: 65 * 60_000, bucketMs: 60_000, label: "1h" }, // up to 1h: 1-min bucket
  { maxSpanMs: 6 * 3_600_000, bucketMs: 5 * 60_000, label: "6h" }, // up to 6h: 5-min bucket
  { maxSpanMs: 25 * 3_600_000, bucketMs: 30 * 60_000, label: "24h" }, // up to 24h: 30-min bucket
  { maxSpanMs: 8 * 86_400_000, bucketMs: 3_600_000, label: "7d" }, // up to 7d: 1h bucket
  {
    maxSpanMs: 32 * 86_400_000,
    bucketMs: 6 * 3_600_000,
    label: "30d",
  }, // up to 30d: 6h bucket
  {
    maxSpanMs: Number.POSITIVE_INFINITY,
    bucketMs: 86_400_000,
    label: "all",
  }, // beyond: 1d bucket
];

/**
 * Snap an arbitrary time range to the canonical bucket for its span.
 * Returns the rounded boundaries plus a stable label that doubles as the
 * cache slot identifier. Callers use the label in the cache key so two
 * requests for the "same" window hit the same slot regardless of which
 * sub-minute timestamp the client computed.
 */
function snapToWindowPreset(timeRange: {
  from: number;
  to: number;
}): { from: number; to: number; label: string } {
  const span = Math.max(0, timeRange.to - timeRange.from);
  const preset =
    DISCOVER_WINDOW_PRESETS.find((p) => span <= p.maxSpanMs) ??
    DISCOVER_WINDOW_PRESETS[DISCOVER_WINDOW_PRESETS.length - 1]!;
  const to = Math.ceil(timeRange.to / preset.bucketMs) * preset.bucketMs;
  // Reconstruct `from` from the snapped span so the cache key reflects
  // the canonical window, not the original (drifty) boundaries.
  const from = to - Math.round(span / preset.bucketMs) * preset.bucketMs;
  return { from, to, label: preset.label };
}

function facetValuesCacheKey(params: FacetValuesParams): string {
  // "Live" time ranges roll forward by milliseconds each request — bucket to the
  // minute so identical user intent hits the same cache slot.
  return [
    params.tenantId,
    params.facetKey,
    bucketTime(params.timeRange.from),
    bucketTime(params.timeRange.to),
    params.prefix ?? "",
    params.limit,
    params.offset,
  ].join("|");
}

function discoverCacheKey(params: DiscoverParams): string {
  const snapped = snapToWindowPreset(params.timeRange);
  return [params.tenantId, snapped.label, snapped.to].join("|");
}

interface CategoricalFacetDescriptor {
  key: string;
  kind: "categorical";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  topValues: { value: string; label?: string; count: number }[];
  totalDistinct: number;
}

interface RangeFacetDescriptor {
  key: string;
  kind: "range";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  min: number;
  max: number;
}

interface DynamicKeysFacetDescriptor {
  key: string;
  kind: "dynamic_keys";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  topKeys: { value: string; count: number }[];
  totalDistinct: number;
}

type FacetDescriptor =
  | CategoricalFacetDescriptor
  | RangeFacetDescriptor
  | DynamicKeysFacetDescriptor;

interface FacetValuesResult {
  values: { value: string; label?: string; count: number }[];
  totalDistinct: number;
}

const discoverLogger = createLogger(
  "langwatch:app-layer:traces:trace-list-discover",
);

function isExpressionCategorical(
  def: FacetDefinition,
): def is ExpressionCategoricalDef {
  return def.kind === "categorical" && "expression" in def;
}

const SORT_COLUMN_MAP: Record<string, TraceListSort["column"]> = {
  time: "OccurredAt",
  duration: "TotalDurationMs",
  cost: "TotalCost",
  spans: "SpanCount",
  tokens: "TotalTokens",
  ttft: "TimeToFirstTokenMs",
  tokensIn: "TotalPromptTokenCount",
  tokensOut: "TotalCompletionTokenCount",
};

const FACET_EXPRESSIONS: Record<string, string> = {
  origin: "Attributes['langwatch.origin']",
  status: TRACE_STATUS_CLICKHOUSE_EXPRESSION,
  service: "Attributes['service.name']",
};

const MODEL_FACET_QUERY = "arrayJoin(Models)";

const SUGGEST_COLUMN_MAP: Record<string, string> = {
  model: "arrayJoin(Models)",
  service: "Attributes['service.name']",
  user: "Attributes['langwatch.user_id']",
  origin: "Attributes['langwatch.origin']",
};

export class TraceListService {
  constructor(
    private readonly repository: TraceListRepository,
    private readonly evaluationRunService: EvaluationRunService,
    private readonly topicService: TopicService,
  ) {}

  /**
   * Replace TopicId/SubTopicId facet values with friendly names from Postgres.
   * The `value` field stays as the ID (used for filtering); `label` carries the name.
   */
  private async enrichTopicNames(
    projectId: string,
    result: CategoricalFacetResult,
  ): Promise<CategoricalFacetResult> {
    const ids = result.values.map((v) => v.value).filter(Boolean);
    if (ids.length === 0) return result;
    const names = await this.topicService.getNamesByIds(projectId, ids);
    return {
      ...result,
      values: result.values.map((v) => {
        const name = names.get(v.value);
        return name ? { ...v, label: name } : v;
      }),
    };
  }

  async getList(params: ListParams): Promise<TraceListPage> {
    const sortColumn = SORT_COLUMN_MAP[params.sort.columnId] ?? "OccurredAt";

    const result = await this.repository.findAll({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      sort: { column: sortColumn, direction: params.sort.direction },
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
      filterWhere: params.filterWhere,
    });

    const items = result.rows.map((row) => mapToTraceListItem(row));
    const traceIds = items.map((item) => item.traceId);

    const evaluations = await this.evaluationRunService.findSummariesByTraceIds(
      params.tenantId,
      traceIds,
      params.timeRange.from,
    );

    return {
      items,
      totalHits: result.totalHits,
      evaluations,
    };
  }

  async getFacets(params: FacetParams): Promise<FacetCounts> {
    const facetPromises = Object.entries(FACET_EXPRESSIONS).map(
      async ([name, expression]) => {
        const result = await this.repository.findFacetCounts({
          tenantId: params.tenantId,
          timeRange: params.timeRange,
          facetExpression: expression,
          filterWhere: params.filterWhere,
        });
        return [name, result.values] as const;
      },
    );

    const modelFacetPromise = this.repository.findFacetCounts({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      facetExpression: MODEL_FACET_QUERY,
      filterWhere: params.filterWhere,
    });

    const rangePromises = {
      tokens: this.repository.findRangeStats({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        column: "TotalPromptTokenCount + TotalCompletionTokenCount",
        filterWhere: params.filterWhere,
      }),
      cost: this.repository.findRangeStats({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        column: "TotalCost",
        filterWhere: params.filterWhere,
      }),
      latency: this.repository.findRangeStats({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        column: "TotalDurationMs",
        filterWhere: params.filterWhere,
      }),
    };

    const [facetResults, modelResult, tokensRange, costRange, latencyRange] =
      await Promise.all([
        Promise.all(facetPromises),
        modelFacetPromise,
        rangePromises.tokens,
        rangePromises.cost,
        rangePromises.latency,
      ]);

    const facets: Record<string, Record<string, number>> = {};
    for (const [name, values] of facetResults) {
      facets[name] = values;
    }

    return {
      origin: facets.origin ?? {},
      status: facets.status ?? {},
      service: facets.service ?? {},
      model: modelResult.values,
      ranges: {
        tokens: tokensRange,
        cost: costRange,
        latency: latencyRange,
      },
    };
  }

  async getNewCount(params: NewCountParams): Promise<number> {
    return this.repository.findCount({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      since: params.since,
      filterWhere: params.filterWhere,
    });
  }

  async getSuggestions(params: SuggestParams): Promise<string[]> {
    const column = SUGGEST_COLUMN_MAP[params.field];
    if (!column) return [];

    return this.repository.findDistinctValues({
      tenantId: params.tenantId,
      column,
      prefix: params.prefix,
      limit: params.limit ?? 20,
    });
  }

  /** Per-pod dedup of in-flight background refreshes. */
  private readonly discoverRefreshing = new Set<string>();

  async getDiscover(params: DiscoverParams): Promise<FacetDescriptor[]> {
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
    const cacheKey = discoverCacheKey(params);
    const cached = await DISCOVER_CACHE.get(cacheKey);

    if (cached) {
      // Stale-while-revalidate: hand back the cached payload and kick
      // off a background refresh when it's older than the 1-min
      // threshold. The refresh broadcasts `discover_updated` on
      // completion so any open browser invalidates and re-reads from
      // the now-warm cache.
      if (Date.now() - cached.timestamp > DISCOVER_REFRESH_AFTER_MS) {
        this.refreshDiscoverInBackground(snappedParams, cacheKey);
      }
      return cached.value;
    }

    // Cold miss: return an empty payload IMMEDIATELY + start an async
    // compute that will hydrate the cache and SSE-broadcast when done.
    // Caller (`tracesV2.discover` → React Query → `useTraceFacets`)
    // renders the synthetic FACET_DEFAULTS skeleton while waiting, so
    // the user never blocks on the 1-2s ClickHouse scan. Trade-off:
    // first viewer sees an empty sidebar for ~1-2s instead of a
    // spinner; subsequent viewers within the TTL hit the warm cache.
    // The discover_updated SSE push fills in the values without the
    // user having to refresh.
    this.refreshDiscoverInBackground(snappedParams, cacheKey);
    return [];
  }

  private refreshDiscoverInBackground(
    params: DiscoverParams,
    cacheKey: string,
  ): void {
    // Per-pod dedup: avoid stacking redundant background refreshes on
    // the same key inside this process. Cross-pod dedup uses
    // `DISCOVER_CACHE.claim()` (a Redis SET NX EX leadership lease) so
    // only one pod in the fleet pays the compute cost per refresh
    // window. If we don't win the claim, another pod is already on it
    // and its result will land in the shared cache for us shortly.
    if (this.discoverRefreshing.has(cacheKey)) return;
    this.discoverRefreshing.add(cacheKey);

    void (async () => {
      try {
        // 60s lease (set on the dedicated lock cache) is enough for any
        // single compute (timings cap around 5-8s on the slowest
        // tenants) and self-clears on pod crash. We claim once per
        // refresh attempt — if we lose the claim, another pod is
        // already on it and its write will hydrate the value cache for
        // every reader.
        const claimed = await DISCOVER_REFRESH_LOCK_CACHE.claim(
          cacheKey,
          Date.now(),
        );
        if (!claimed) return;

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
              error:
                broadcastErr instanceof Error
                  ? broadcastErr.message
                  : String(broadcastErr),
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

  private async computeDiscover(
    params: DiscoverParams,
  ): Promise<FacetDescriptor[]> {
    const TOP_N = 50;

    // Partition the registry: simple-expression facets per table go through
    // the batched ClickHouse path; arrayJoin/queryBuilder/dynamic_keys facets
    // can't share a scan and run independently.
    const batched = new Map<
      FacetTable,
      {
        categoricals: ExpressionCategoricalDef[];
        ranges: RangeFacetDef[];
      }
    >();
    const standalone: FacetDefinition[] = [];

    for (const def of FACET_REGISTRY) {
      if (def.kind === "categorical") {
        if (
          isExpressionCategorical(def) &&
          !def.expression.includes("arrayJoin")
        ) {
          const slot = batched.get(def.table) ?? {
            categoricals: [],
            ranges: [],
          };
          slot.categoricals.push(def);
          batched.set(def.table, slot);
        } else {
          standalone.push(def);
        }
      } else if (def.kind === "range") {
        const slot = batched.get(def.table) ?? {
          categoricals: [],
          ranges: [],
        };
        slot.ranges.push(def);
        batched.set(def.table, slot);
      } else {
        standalone.push(def);
      }
    }

    type Outcome =
      | { kind: "batch"; table: FacetTable; result: BatchedFacetResult }
      | { kind: "standalone"; key: string; descriptor: FacetDescriptor };

    const tasks: Promise<Outcome>[] = [];
    // Per-task wall-clock so a slow discover surfaces which query is at fault.
    const taskTimings: Array<{ label: string; durationMs: number }> = [];
    const startedAt = Date.now();
    const wrap = <T>(label: string, p: Promise<T>): Promise<T> => {
      const t0 = Date.now();
      return p.finally(() => {
        taskTimings.push({ label, durationMs: Date.now() - t0 });
      });
    };

    for (const [table, slot] of batched) {
      tasks.push(
        wrap(
          `batch:${table}`,
          this.repository
            .findBatchedFacets({
              tenantId: params.tenantId,
              timeRange: params.timeRange,
              table,
              timeColumn: TABLE_TIME_COLUMNS[table],
              categoricalSpecs: slot.categoricals.map((d) => ({
                key: d.key,
                expression: d.expression,
              })),
              rangeSpecs: slot.ranges.map((d) => ({
                key: d.key,
                expression: d.expression,
              })),
              topN: TOP_N,
            })
            .then((result): Outcome => ({ kind: "batch", table, result })),
        ),
      );
    }

    for (const def of standalone) {
      tasks.push(
        wrap(
          `standalone:${def.kind}:${def.key}`,
          (async (): Promise<Outcome> => {
            let descriptor: FacetDescriptor;
            switch (def.kind) {
              case "categorical":
                descriptor = await this.discoverCategorical(def, params, TOP_N);
                break;
              case "range":
                descriptor = await this.discoverRange(def, params);
                break;
              case "dynamic_keys":
                descriptor = await this.discoverDynamicKeys(
                  def,
                  params,
                  TOP_N,
                );
                break;
            }
            return { kind: "standalone", key: def.key, descriptor };
          })(),
        ),
      );
    }

    const settled = await Promise.allSettled(tasks);
    const totalMs = Date.now() - startedAt;
    if (totalMs > 1500) {
      taskTimings.sort((a, b) => b.durationMs - a.durationMs);
      discoverLogger.info(
        {
          tenantId: params.tenantId,
          totalMs,
          breakdown: taskTimings.slice(0, 20),
          taskCount: tasks.length,
        },
        "Discover wall-clock exceeded 1.5s — per-task breakdown",
      );
    }

    const batchByTable = new Map<FacetTable, BatchedFacetResult>();
    const standaloneByKey = new Map<string, FacetDescriptor>();

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
      } else {
        standaloneByKey.set(result.value.key, result.value.descriptor);
      }
    }

    // Assemble in registry order so the sidebar's group ordering is preserved.
    const facets: FacetDescriptor[] = [];
    for (const def of FACET_REGISTRY) {
      const descriptor = await this.materializeDescriptor(
        def,
        params,
        batchByTable,
        standaloneByKey,
      );
      if (descriptor) facets.push(descriptor);
    }
    return facets;
  }

  private async materializeDescriptor(
    def: FacetDefinition,
    params: DiscoverParams,
    batchByTable: Map<FacetTable, BatchedFacetResult>,
    standaloneByKey: Map<string, FacetDescriptor>,
  ): Promise<FacetDescriptor | null> {
    if (def.kind === "categorical" && isExpressionCategorical(def)) {
      if (def.expression.includes("arrayJoin")) {
        return standaloneByKey.get(def.key) ?? null;
      }
      const batch = batchByTable.get(def.table);
      const raw = batch?.categoricals[def.key];
      if (!raw) return null;
      const enriched =
        def.key === "topic" || def.key === "subtopic"
          ? await this.enrichTopicNames(params.tenantId, raw)
          : raw;
      return {
        key: def.key,
        kind: "categorical",
        label: def.label,
        group: def.group,
        topValues: enriched.values,
        totalDistinct: enriched.totalDistinct,
      };
    }

    if (def.kind === "range") {
      const batch = batchByTable.get(def.table);
      const range = batch?.ranges[def.key];
      if (!range) return null;
      return {
        key: def.key,
        kind: "range",
        label: def.label,
        group: def.group,
        min: range.min,
        max: range.max,
      };
    }

    return standaloneByKey.get(def.key) ?? null;
  }

  /** Per-pod dedup of in-flight background refreshes. */
  private readonly facetValuesRefreshing = new Set<string>();

  async getFacetValues(params: FacetValuesParams): Promise<FacetValuesResult> {
    const cacheKey = facetValuesCacheKey(params);
    const cached = await FACET_VALUES_CACHE.get(cacheKey);

    if (cached) {
      // Always serve the cached value immediately. If it's older than the
      // refresh threshold, fire-and-forget a recomputation so the next read
      // sees fresher data.
      if (Date.now() - cached.timestamp > FACET_VALUES_REFRESH_AFTER_MS) {
        this.refreshFacetValuesInBackground(params, cacheKey);
      }
      return cached.value;
    }

    // Cold miss — must compute synchronously so the user gets a result.
    const result = await this.computeFacetValues(params);
    await FACET_VALUES_CACHE.set(cacheKey, {
      value: result,
      timestamp: Date.now(),
    });
    return result;
  }

  private refreshFacetValuesInBackground(
    params: FacetValuesParams,
    cacheKey: string,
  ): void {
    if (this.facetValuesRefreshing.has(cacheKey)) return;
    this.facetValuesRefreshing.add(cacheKey);

    void this.computeFacetValues(params)
      .then((fresh) =>
        FACET_VALUES_CACHE.set(cacheKey, {
          value: fresh,
          timestamp: Date.now(),
        }),
      )
      .catch((err) => {
        discoverLogger.warn(
          {
            cacheKey,
            error: err instanceof Error ? err.message : String(err),
          },
          "Background facet-values refresh failed; cached value still served",
        );
      })
      .finally(() => {
        this.facetValuesRefreshing.delete(cacheKey);
      });
  }

  private async computeFacetValues(
    params: FacetValuesParams,
  ): Promise<FacetValuesResult> {
    // Dynamic per-attribute drill: "attribute.<key>" — not in the static registry.
    if (params.facetKey.startsWith("attribute.")) {
      return this.attributeFacetValues(params);
    }

    const def = FACET_REGISTRY.find((d) => d.key === params.facetKey);
    if (!def) {
      throw new Error(`Unknown facet: ${params.facetKey}`);
    }
    if (def.kind === "range") {
      throw new Error("Cannot drill into range facet");
    }

    let result: CategoricalFacetResult;
    if (isExpressionCategorical(def)) {
      result = await this.repository.findCategoricalFacet({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        table: def.table,
        timeColumn: TABLE_TIME_COLUMNS[def.table],
        facetExpression: def.expression,
        limit: params.limit,
        offset: params.offset,
        prefix: params.prefix,
      });
    } else {
      const query = def.queryBuilder({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        limit: params.limit,
        offset: params.offset,
        prefix: params.prefix,
      });
      result = await this.repository.findCategoricalFacetRaw({
        tenantId: params.tenantId,
        query,
      });
    }

    if (def.key === "topic" || def.key === "subtopic") {
      result = await this.enrichTopicNames(params.tenantId, result);
    }

    return result;
  }

  private async attributeFacetValues(
    params: FacetValuesParams,
  ): Promise<FacetValuesResult> {
    const attributeKey = params.facetKey.slice("attribute.".length);
    if (!attributeKey || !ATTRIBUTE_KEY_REGEX.test(attributeKey)) {
      throw new Error(`Invalid attribute key: ${attributeKey}`);
    }

    return this.repository.findAttributeValues({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      attributeKey,
      limit: params.limit,
      offset: params.offset,
      ...(params.prefix ? { prefix: params.prefix } : {}),
    });
  }

  private async discoverCategorical(
    def: FacetDefinition & { kind: "categorical" },
    params: DiscoverParams,
    limit: number,
  ): Promise<CategoricalFacetDescriptor> {
    let result: CategoricalFacetResult;

    if (isExpressionCategorical(def)) {
      result = await this.repository.findCategoricalFacet({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        table: def.table,
        timeColumn: TABLE_TIME_COLUMNS[def.table],
        facetExpression: def.expression,
        limit,
        offset: 0,
      });
    } else {
      const query = def.queryBuilder({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        limit,
        offset: 0,
      });
      result = await this.repository.findCategoricalFacetRaw({
        tenantId: params.tenantId,
        query,
      });
    }

    if (def.key === "topic" || def.key === "subtopic") {
      result = await this.enrichTopicNames(params.tenantId, result);
    }

    return {
      key: def.key,
      kind: "categorical",
      label: def.label,
      group: def.group,
      topValues: result.values,
      totalDistinct: result.totalDistinct,
    };
  }

  private async discoverRange(
    def: RangeFacetDef,
    params: DiscoverParams,
  ): Promise<RangeFacetDescriptor> {
    const result = await this.repository.findRangeStatsForTable({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      table: def.table,
      timeColumn: TABLE_TIME_COLUMNS[def.table],
      column: def.expression,
    });

    return {
      key: def.key,
      kind: "range",
      label: def.label,
      group: def.group,
      min: result.min,
      max: result.max,
    };
  }

  private async discoverDynamicKeys(
    def: FacetDefinition & { kind: "dynamic_keys" },
    params: DiscoverParams,
    limit: number,
  ): Promise<DynamicKeysFacetDescriptor> {
    const query = def.queryBuilder({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      limit,
      offset: 0,
    });
    const result = await this.repository.findCategoricalFacetRaw({
      tenantId: params.tenantId,
      query,
    });

    return {
      key: def.key,
      kind: "dynamic_keys",
      label: def.label,
      group: def.group,
      topKeys: result.values.map((v) => ({
        value: v.value,
        count: v.count,
      })),
      totalDistinct: result.totalDistinct,
    };
  }
}

function mapToTraceListItem(row: TraceSummaryData): TraceListItem {
  const status = deriveTraceStatus(row);

  const totalTokens =
    (row.totalPromptTokenCount ?? 0) + (row.totalCompletionTokenCount ?? 0);

  // The list never surfaced trace-level events (the list query selects no
  // event columns); events are derived per-trace only on the detail read.
  const events: TraceListEvent[] = [];

  return {
    traceId: row.traceId,
    timestamp: row.occurredAt,
    name: row.attributes["langwatch.span.name"] ?? row.traceId.slice(0, 8),
    serviceName: row.attributes["service.name"] ?? "",
    durationMs: row.totalDurationMs,
    totalCost: row.totalCost ?? 0,
    totalTokens,
    inputTokens: row.totalPromptTokenCount,
    outputTokens: row.totalCompletionTokenCount,
    models: row.models,
    status,
    spanCount: row.spanCount,
    input: row.computedInput,
    output: row.computedOutput,
    error: row.errorMessage,
    conversationId: row.attributes["gen_ai.conversation.id"] ?? null,
    userId: row.attributes["langwatch.user_id"] ?? null,
    origin: row.attributes["langwatch.origin"] ?? "application",
    tokensEstimated: row.tokensEstimated,
    ttft: row.timeToFirstTokenMs,
    traceName: row.traceName,
    rootSpanType: row.rootSpanType,
    events,
  };
}
