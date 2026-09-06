import { VisibilityWindowService } from "./trace-visibility-window.service.ts";
import { TraceDiscoverService, type DiscoverBroadcaster } from "./trace-discover.service.ts";
import { TraceFacetValuesService } from "./trace-facet-values.service.ts";
import { TraceTopicNamingService } from "./trace-topic-naming.service.ts";
import type { DiscoverParams, FacetValuesParams } from "../rules/trace-list-cache-key.rules.ts";
import {
  cursorForTraceRow,
  mapToTraceListItem,
  SORT_COLUMN_MAP,
} from "../rules/trace-list-row.rules.ts";
import type { TopicService } from "@langwatch/topic-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import {
  TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
  TRACE_STATUS_CLICKHOUSE_EXPRESSION,
} from "@langwatch/trace-contract";
import type {
  DiscoverResult,
  FacetValuesResult,
  TraceListCursor,
  TraceListFacetCounts,
  TraceListPage,
  TraceListReadPort,
} from "@langwatch/trace-contract";
import { TRACE_LIST_MAX_OFFSET_ROWS } from "@langwatch/trace-contract";
import { PageTooDeepError } from "@langwatch/trace-contract";

interface ListParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  sort: { columnId: string; direction: "asc" | "desc" };
  /** 1-based offset compatibility for non-cursor callers. */
  page?: number;
  pageSize: number;
  cursor?: TraceListCursor;
  filterWhere?: { sql: string; params: Record<string, unknown> };
  /**
   * Visibility gate: list items older than this cutoff get their
   * input/output previews teaser-redacted. Omitted/null = ungated.
   */
  visibilityCutoffMs?: number | null;
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

const FACET_EXPRESSIONS: Record<string, string> = {
  origin: TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
  status: TRACE_STATUS_CLICKHOUSE_EXPRESSION,
  service: "Attributes['service.name']",
};

const MODEL_FACET_QUERY = "arrayJoin(Models)";

const SUGGEST_COLUMN_MAP: Record<string, string> = {
  model: "arrayJoin(Models)",
  service: "Attributes['service.name']",
  user: "Attributes['langwatch.user_id']",
  origin: TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
};

export class TraceListService {
  static create({
    repository,
    evaluations,
    topicService,
  }: {
    repository: TraceListReadPort;
    evaluations: EvaluationService;
    topicService: TopicService;
  }): TraceListService {
    const topicNaming = TraceTopicNamingService.create({ topicService });

    return new TraceListService(
      repository,
      evaluations,
      TraceDiscoverService.create({ repository, topicNaming }),
      TraceFacetValuesService.create({ repository, topicNaming }),
    );
  }

  private constructor(
    private readonly repository: TraceListReadPort,
    private readonly evaluations: EvaluationService,
    private readonly discover: TraceDiscoverService,
    private readonly facetValues: TraceFacetValuesService,
  ) {}

  /** The cached facet discovery for the sidebar. */
  getDiscover(params: DiscoverParams): Promise<DiscoverResult> {
    return this.discover.getDiscover(params);
  }

  /** One facet's values, cached, for a sidebar drill-in. */
  getFacetValues(params: FacetValuesParams): Promise<FacetValuesResult> {
    return this.facetValues.getFacetValues(params);
  }

  /** Wires the SSE push a background discover refresh fires when it lands. */
  static setDiscoverBroadcaster(fn: DiscoverBroadcaster | null): void {
    TraceDiscoverService.setDiscoverBroadcaster(fn);
  }

  async getList(params: ListParams): Promise<TraceListPage> {
    const sortColumn = SORT_COLUMN_MAP[params.sort.columnId] ?? "OccurredAt";

    // Position reads pay for every skipped row, so their depth is bounded;
    // cursor reads are keyset and stay open-ended. The pagination bar greys
    // out the pages this refuses, so the error is for callers that bypass it.
    const offset = params.cursor ? 0 : (Math.max(params.page ?? 1, 1) - 1) * params.pageSize;
    if (offset + params.pageSize > TRACE_LIST_MAX_OFFSET_ROWS) {
      throw new PageTooDeepError(TRACE_LIST_MAX_OFFSET_ROWS);
    }

    const result = await this.repository.findAll({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      sort: { column: sortColumn, direction: params.sort.direction },
      // Read one sentinel row so `nextCursor` is exact without guessing from
      // totalHits (which may change under a live range between requests).
      limit: params.pageSize + 1,
      cursor: params.cursor,
      offset,
      filterWhere: params.filterWhere,
    });

    const hasMore = result.rows.length > params.pageSize;
    const visibleRows = hasMore ? result.rows.slice(0, params.pageSize) : result.rows;
    const items = visibleRows.map((row) => mapToTraceListItem(row));
    const traceIds = items.map((item) => item.traceId);

    const evaluations = await this.evaluations.findSummariesByTraceIds({
      tenantId: params.tenantId,
      traceIds,
      since: params.timeRange.from,
    });

    // Tease input/output/error previews and user-authored labels of items
    // beyond the caller's visibility window — existence and counts stay
    // untouched. Labels are user-authored metadata strings, so they're gated
    // alongside the content fields to avoid leaking through on old traces.
    const gatedItems =
      params.visibilityCutoffMs === null || params.visibilityCutoffMs === undefined
        ? items
        : items.map((item) =>
            item.timestamp < params.visibilityCutoffMs!
              ? {
                  ...item,
                  input: item.input ? VisibilityWindowService.teaserOf(item.input) : item.input,
                  output: item.output ? VisibilityWindowService.teaserOf(item.output) : item.output,
                  error: item.error ? VisibilityWindowService.teaserOf(item.error) : item.error,
                  labels: item.labels.map((label) => VisibilityWindowService.teaserOf(label)),
                }
              : item,
          );

    return {
      items: gatedItems,
      totalHits: result.totalHits,
      evaluations,
      nextCursor:
        hasMore && visibleRows.length > 0
          ? cursorForTraceRow(visibleRows[visibleRows.length - 1]!, sortColumn)
          : null,
    };
  }

  async getFacets(params: FacetParams): Promise<TraceListFacetCounts> {
    const facetPromises = Object.entries(FACET_EXPRESSIONS).map(async ([name, expression]) => {
      const result = await this.repository.findFacetCounts({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        facetExpression: expression,
        filterWhere: params.filterWhere,
      });

      return [name, result.values] as const;
    });

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

    const [facetResults, modelResult, tokensRange, costRange, latencyRange] = await Promise.all([
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
    if (!column) {
      return [];
    }

    return this.repository.findDistinctValues({
      tenantId: params.tenantId,
      column,
      prefix: params.prefix,
      limit: params.limit ?? 20,
    });
  }
}
