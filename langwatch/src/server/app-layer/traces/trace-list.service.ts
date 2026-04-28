import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { EvalSummary } from "~/server/app-layer/evaluations/types";
import type { TopicService } from "~/server/app-layer/topics/topic.service";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import type {
  ExpressionCategoricalDef,
  FacetDefinition,
  RangeFacetDef,
} from "./facet-registry";
import { FACET_REGISTRY, TABLE_TIME_COLUMNS } from "./facet-registry";
import type {
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
  rootSpanName: string | null;
  rootSpanType: string | null;
  events: TraceListEvent[];
}

export interface TraceListPage {
  items: TraceListItem[];
  totalHits: number;
  evaluations: Record<string, EvalSummary[]>;
}

export interface FacetCounts {
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

export interface ListParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  sort: { columnId: string; direction: "asc" | "desc" };
  page: number;
  pageSize: number;
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

export interface FacetParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

export interface NewCountParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  since: number;
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

export interface SuggestParams {
  tenantId: string;
  field: string;
  prefix: string;
  limit?: number;
}

export interface DiscoverParams {
  tenantId: string;
  timeRange: { from: number; to: number };
}

export interface FacetValuesParams {
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
 */
const FACET_VALUES_TTL_MS = 5 * 60 * 1000; // cache lives up to 5 minutes
const FACET_VALUES_REFRESH_AFTER_MS = 30_000; // background refresh if older than 30s

interface CachedFacetValues {
  value: FacetValuesResult;
  timestamp: number;
}

const FACET_VALUES_CACHE = new TtlCache<CachedFacetValues>(
  FACET_VALUES_TTL_MS,
  "tracesV2:facetValues:",
);

/** Bucket size for live-range time params so the cache key stabilises across rapid refetches. */
const CACHE_TIME_BUCKET_MS = 60_000;

function bucketTime(ts: number): number {
  return Math.floor(ts / CACHE_TIME_BUCKET_MS) * CACHE_TIME_BUCKET_MS;
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

export interface CategoricalFacetDescriptor {
  key: string;
  kind: "categorical";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  topValues: { value: string; label?: string; count: number }[];
  totalDistinct: number;
}

export interface RangeFacetDescriptor {
  key: string;
  kind: "range";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  min: number;
  max: number;
}

export interface DynamicKeysFacetDescriptor {
  key: string;
  kind: "dynamic_keys";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  topKeys: { value: string; count: number }[];
  totalDistinct: number;
}

export type FacetDescriptor =
  | CategoricalFacetDescriptor
  | RangeFacetDescriptor
  | DynamicKeysFacetDescriptor;

export interface FacetValuesResult {
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
};

const FACET_EXPRESSIONS: Record<string, string> = {
  origin: "Attributes['langwatch.origin']",
  status:
    "if(ContainsErrorStatus = 1, 'error', if(ContainsOKStatus = 1, 'ok', 'warning'))",
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

  async list(params: ListParams): Promise<TraceListPage> {
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
    );

    return {
      items,
      totalHits: result.totalHits,
      evaluations,
    };
  }

  async facets(params: FacetParams): Promise<FacetCounts> {
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

  async newCount(params: NewCountParams): Promise<number> {
    return this.repository.findCount({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      since: params.since,
      filterWhere: params.filterWhere,
    });
  }

  async suggest(params: SuggestParams): Promise<string[]> {
    const column = SUGGEST_COLUMN_MAP[params.field];
    if (!column) return [];

    return this.repository.findDistinctValues({
      tenantId: params.tenantId,
      column,
      prefix: params.prefix,
      limit: params.limit ?? 20,
    });
  }

  async discover(params: DiscoverParams): Promise<FacetDescriptor[]> {
    const TOP_N = 10;

    const promises = FACET_REGISTRY.map(async (def) => {
      switch (def.kind) {
        case "categorical":
          return this.discoverCategorical(def, params, TOP_N);
        case "range":
          return this.discoverRange(def, params);
        case "dynamic_keys":
          return this.discoverDynamicKeys(def, params, TOP_N);
      }
    });

    const results = await Promise.allSettled(promises);

    const facets: FacetDescriptor[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        facets.push(result.value);
      } else {
        discoverLogger.warn(
          { error: String(result.reason) },
          "Facet discovery query failed, omitting facet",
        );
      }
    }

    return facets;
  }

  /** Per-pod dedup of in-flight background refreshes. */
  private readonly facetValuesRefreshing = new Set<string>();

  async facetValues(params: FacetValuesParams): Promise<FacetValuesResult> {
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
  const status: "ok" | "error" | "warning" = row.containsErrorStatus
    ? "error"
    : row.containsOKStatus
      ? "ok"
      : "warning";

  const totalTokens =
    (row.totalPromptTokenCount ?? 0) + (row.totalCompletionTokenCount ?? 0);

  const events: TraceListEvent[] = (row.events ?? []).map((e) => ({
    spanId: e.spanId,
    timestamp: e.timestamp,
    name: e.name,
  }));

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
    rootSpanName: row.rootSpanName,
    rootSpanType: row.rootSpanType,
    events,
  };
}
