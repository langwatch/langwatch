/**
 * Cached facet-value drills for the list sidebar: a stale-while-revalidate cache in front of the
 * store, the static registry's facets, and the dynamic `attribute.` / `span.attribute.` /
 * `event.attribute.` prefixes, whose keys are whitelisted before they reach a query.
 */

import { createLogger } from "@langwatch/observability";
import type {
  CategoricalFacetResult,
  FacetValuesResult,
  TraceListReadPort,
} from "@langwatch/trace-contract";
import { ClickHouseFacetRegistryAdapter } from "@langwatch/trace-server";

import { facetValuesCacheKey, type FacetValuesParams } from "../rules/trace-list-cache-key.rules.ts";
import { isExpressionCategorical } from "../rules/trace-facet-classification.rules.ts";
import { TtlCache } from "./trace-ttl-cache.service.ts";
import type { TraceTopicNamingService } from "./trace-topic-naming.service.ts";

const facetValuesLogger = createLogger("langwatch:app-layer:traces:trace-list-facet-values");

const ATTRIBUTE_KEY_REGEX = /^[a-zA-Z0-9_.-]+$/;

/**
 * Stale-while-revalidate cache for facet value results: a hit returns the cached value and starts
 * a background recomputation once it is older than REFRESH_AFTER_MS. The TTL is long because
 * discover queries scan the whole tenant window. Keys include `tenantId`, so tenants are isolated.
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

export class TraceFacetValuesService {
  private constructor(
    private readonly repository: TraceListReadPort,
    private readonly topicNaming: TraceTopicNamingService,
  ) {}

  static create({
    repository,
    topicNaming,
  }: {
    repository: TraceListReadPort;
    topicNaming: TraceTopicNamingService;
  }): TraceFacetValuesService {
    return new TraceFacetValuesService(repository, topicNaming);
  }

  /** Per-pod dedup of in-flight background refreshes. */
  private readonly facetValuesRefreshing = new Set<string>();

  async getFacetValues(params: FacetValuesParams): Promise<FacetValuesResult> {
    const cacheKey = facetValuesCacheKey(params);
    const cached = await FACET_VALUES_CACHE.tryGet(cacheKey);

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

  private refreshFacetValuesInBackground(params: FacetValuesParams, cacheKey: string): void {
    if (this.facetValuesRefreshing.has(cacheKey)) {
      return;
    }

    this.facetValuesRefreshing.add(cacheKey);

    void this.computeFacetValues(params)
      .then((fresh) =>
        FACET_VALUES_CACHE.set(cacheKey, {
          value: fresh,
          timestamp: Date.now(),
        }),
      )
      .catch((err) => {
        facetValuesLogger.warn(
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

  private async computeFacetValues(params: FacetValuesParams): Promise<FacetValuesResult> {
    // Dynamic per-attribute drills — not in the static registry. Each prefix
    // routes to the store its filter actually queries: `event.attribute.` /
    // `span.attribute.` read stored_spans (Events.Attributes / SpanAttributes),
    // the bare `attribute.` prefix keeps its legacy trace_summaries alias.
    // Order matters: the specific prefixes must match before the generic one.
    if (params.facetKey.startsWith("event.attribute.")) {
      return this.attributeFacetValues(params, "event.attribute.", (p) =>
        this.repository.findEventAttributeValues(p),
      );
    }

    if (params.facetKey.startsWith("span.attribute.")) {
      return this.attributeFacetValues(params, "span.attribute.", (p) =>
        this.repository.findSpanAttributeValues(p),
      );
    }

    if (params.facetKey.startsWith("attribute.")) {
      return this.attributeFacetValues(params, "attribute.", (p) =>
        this.repository.findAttributeValues(p),
      );
    }

    const def = ClickHouseFacetRegistryAdapter.FACET_REGISTRY.find(
      (d) => d.key === params.facetKey,
    );
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
        timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[def.table],
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
      result = await this.topicNaming.enrichTopicNames(params.tenantId, result);
    }

    return result;
  }

  private async attributeFacetValues(
    params: FacetValuesParams,
    facetPrefix: string,
    find: (p: {
      tenantId: string;
      timeRange: { from: number; to: number };
      attributeKey: string;
      prefix?: string;
      limit: number;
      offset: number;
    }) => Promise<CategoricalFacetResult>,
  ): Promise<FacetValuesResult> {
    const attributeKey = params.facetKey.slice(facetPrefix.length);
    if (!attributeKey || !ATTRIBUTE_KEY_REGEX.test(attributeKey)) {
      throw new Error(`Invalid attribute key: ${attributeKey}`);
    }

    return find({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      attributeKey,
      limit: params.limit,
      offset: params.offset,
      ...(params.prefix ? { prefix: params.prefix } : {}),
    });
  }
}
