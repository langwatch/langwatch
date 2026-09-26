/**
 * Cached facet-value drills for the list sidebar: a stale-while-revalidate cache in front of the
 * store, the static registry's facets, and the dynamic `attribute.` / `span.attribute.` /
 * `event.attribute.` prefixes, whose keys are whitelisted before they reach a query.
 */

import { RequestValidationError } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type {
  CategoricalFacetResult,
  FacetValuesResult,
  Protections,
  TraceListRead,
} from "@langwatch/trace-contract";
import { TraceAttributeValuesWithheldError } from "@langwatch/trace-contract";

import { isExpressionCategorical } from "../rules/trace-facet-classification.rules.ts";
import { FACET_REGISTRY, TABLE_TIME_COLUMNS } from "../rules/trace-facet-registry.rules.ts";
import {
  facetValuesCacheKey,
  type FacetValuesParams,
} from "../rules/trace-list-cache-key.rules.ts";
import { TraceAttributeRedactionService } from "./trace-attribute-redaction.service.ts";
import type { TraceTopicNamingService } from "./trace-topic-naming.service.ts";
import { TraceTtlCacheService } from "./trace-ttl-cache.service.ts";

const facetValuesLogger = createLogger("langwatch:app-layer:traces:trace-list-facet-values");

const ATTRIBUTE_KEY_REGEX = /^[a-zA-Z0-9_.-]+$/;

/** The two spellings a REST caller may write for a trace-level attribute. */
const TRACE_ATTRIBUTE_PREFIX = "trace.attribute.";
const TRACE_ATTRIBUTE_PREFIX_LEGACY = "attribute.";

/** Prefixes the facet store reads an attribute key out of, as it spells them. */
const STORE_ATTRIBUTE_PREFIXES: readonly string[] = [
  "event.attribute.",
  "span.attribute.",
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
];

function canReadCapturedContent(protections: Protections): boolean {
  return protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true;
}

/** Whether the redactor leaves one probe key untouched for this viewer. */
function mayReadAttributeValues({
  key,
  protections,
}: {
  key: string;
  protections: Protections;
}): boolean {
  if (!canReadCapturedContent(protections)) return false;
  const probe = { [key]: "" };
  return (
    TraceAttributeRedactionService.create(protections.hiddenAttributes).redact(probe) === probe
  );
}

function unknownFacetError(
  field: string,
  message: string,
  drillableKeys: string[],
): RequestValidationError {
  return new RequestValidationError({
    target: "query",
    violations: [
      { field: "field", type: "unknown_facet", message, expected: drillableKeys, received: field },
    ],
  });
}

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

const FACET_VALUES_CACHE = TraceTtlCacheService.create<CachedFacetValues>(FACET_VALUES_TTL_MS);

export class TraceFacetValuesService {
  private constructor(
    private readonly repository: TraceListRead,
    private readonly topicNaming: TraceTopicNamingService,
  ) {}

  static create({
    repository,
    topicNaming,
  }: {
    repository: TraceListRead;
    topicNaming: TraceTopicNamingService;
  }): TraceFacetValuesService {
    return new TraceFacetValuesService(repository, topicNaming);
  }

  /**
   * The key to hand the facet store: canonical `trace.attribute.<key>` and
   * legacy `attribute.<key>` are one case. Throws
   * `TraceAttributeValuesWithheldError` (403) or `RequestValidationError` (422).
   */
  static resolveFacetKey({
    field,
    protections,
  }: {
    field: string;
    protections: Protections;
  }): string {
    const trimmed = field.trim();
    const normalized = trimmed.startsWith(TRACE_ATTRIBUTE_PREFIX)
      ? `${TRACE_ATTRIBUTE_PREFIX_LEGACY}${trimmed.slice(TRACE_ATTRIBUTE_PREFIX.length)}`
      : trimmed;
    const drillableKeys = FACET_REGISTRY.filter((d) => d.kind !== "range").map((d) => d.key);

    for (const prefix of STORE_ATTRIBUTE_PREFIXES) {
      if (!normalized.startsWith(prefix)) continue;
      if (normalized.length > prefix.length) {
        const key = normalized.slice(prefix.length);
        if (!mayReadAttributeValues({ key, protections })) {
          throw new TraceAttributeValuesWithheldError(trimmed);
        }
        return normalized;
      }
      throw unknownFacetError(
        trimmed,
        `\`${prefix}\` needs an attribute key after it, for example \`${prefix}gen_ai.request.model\`.`,
        drillableKeys,
      );
    }

    if (drillableKeys.includes(normalized)) return normalized;

    throw unknownFacetError(
      trimmed,
      `No facet named \`${trimmed}\` has values to list. Call this endpoint with no field to see which facets this project has, or GET /api/v1/query/reference for every filter field.`,
      drillableKeys,
    );
  }

  /** Whether a resolved facet key names an arbitrary attribute rather than a registry dimension. */
  static isAttributeFacetKey(facetKey: string): boolean {
    return STORE_ATTRIBUTE_PREFIXES.some((prefix) => facetKey.startsWith(prefix));
  }

  /** The window an attribute facet may read: floor raised to the caller's retention cutoff. */
  static visibleWindow({
    timeRange,
    facetKey,
    protections,
  }: {
    timeRange: { from: number; to: number };
    facetKey: string;
    protections: Protections;
  }): { from: number; to: number } {
    const cutoff = protections.visibilityCutoffMs;
    if (cutoff === null || cutoff === undefined) return timeRange;
    if (!TraceFacetValuesService.isAttributeFacetKey(facetKey)) return timeRange;
    return { from: Math.max(timeRange.from, cutoff), to: timeRange.to };
  }

  /** Per-pod dedup of in-flight background refreshes. */
  private readonly facetValuesRefreshing = new Set<string>();

  async getFacetValues(params: FacetValuesParams): Promise<FacetValuesResult> {
    const cacheKey = facetValuesCacheKey(params);
    const lookup = await FACET_VALUES_CACHE.get(cacheKey);

    if (lookup.kind === "hit") {
      const cached = lookup.value;
      // Always serve the cached value immediately. If it's older than the
      // refresh threshold, fire-and-forget a recomputation so the next read
      // sees fresher data.
      if (nowInstant().epochMilliseconds - cached.timestamp > FACET_VALUES_REFRESH_AFTER_MS) {
        this.refreshFacetValuesInBackground(params, cacheKey);
      }

      return cached.value;
    }

    // Cold miss — must compute synchronously so the user gets a result.
    const result = await this.computeFacetValues(params);
    await FACET_VALUES_CACHE.set(cacheKey, {
      value: result,
      timestamp: nowInstant().epochMilliseconds,
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
          timestamp: nowInstant().epochMilliseconds,
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
