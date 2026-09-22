import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
  TRACE_LIST_MAX_OFFSET_ROWS,
  PageTooDeepError,
} from "@langwatch/trace-contract";
import type {
  DiscoverResult,
  FacetDescriptor,
  FacetValuesResult,
  TraceListCursor,
  TraceListItem,
  TraceListPage,
  TraceListRead,
} from "@langwatch/trace-contract";

import type { FacetFilterResolver } from "../rules/trace-facet-filter.rules.ts";
import type { DiscoverParams, FacetValuesParams } from "../rules/trace-list-cache-key.rules.ts";
import {
  cursorForTraceRow,
  mapToTraceListItem,
  SORT_COLUMN_MAP,
} from "../rules/trace-list-row.rules.ts";
import { TraceDiscoverService, type DiscoverBroadcaster } from "./trace-discover.service.ts";
import { TraceFacetValuesService } from "./trace-facet-values.service.ts";
import { TraceTopicNamingService } from "./trace-topic-naming.service.ts";
import { VisibilityWindowService } from "./trace-visibility-window.service.ts";

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
  /** The exact window the list reads, never snapped. */
  timeRange: { from: number; to: number; live?: boolean };
  /** The predicate each facet is counted under. */
  filterFor: FacetFilterResolver;
}

interface NewCountParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  since: number;
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

interface TraceIdsParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  filterWhere?: { sql: string; params: Record<string, unknown> };
  limit: number;
}

interface SuggestParams {
  tenantId: string;
  field: string;
  prefix: string;
  limit?: number;
}

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
    repository: TraceListRead;
    evaluations: EvaluationApi;
    topicService: TopicApi;
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
    private readonly repository: TraceListRead,
    private readonly evaluations: EvaluationApi,
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

  /**
   * Teases input/output/error previews and user-authored labels beyond the
   * caller's visibility window — existence and counts stay untouched.
   * Labels are gated alongside content to avoid leaking through on old traces.
   */
  static #gateItems(
    items: TraceListItem[],
    visibilityCutoffMs: number | null | undefined,
  ): TraceListItem[] {
    if (visibilityCutoffMs === null || visibilityCutoffMs === undefined) {
      return items;
    }

    return items.map((item) =>
      item.timestamp < visibilityCutoffMs ? TraceListService.#teaseItem(item) : item,
    );
  }

  static #teaseItem(item: TraceListItem): TraceListItem {
    return {
      ...item,
      input: item.input ? VisibilityWindowService.teaserOf(item.input) : item.input,
      output: item.output ? VisibilityWindowService.teaserOf(item.output) : item.output,
      error: item.error ? VisibilityWindowService.teaserOf(item.error) : item.error,
      labels: item.labels.map((label) => VisibilityWindowService.teaserOf(label)),
    };
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

    const gatedItems = TraceListService.#gateItems(items, params.visibilityCutoffMs);

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

  /**
   * The sidebar's counts under the active query, uncached: descriptors, each
   * facet exempt from its own terms (ADR-139). The unfiltered vocabulary and
   * warm start stay with `getDiscover`.
   */
  getFacets(params: FacetParams): Promise<FacetDescriptor[]> {
    return this.discover.getFilteredFacets({
      params: { tenantId: params.tenantId, timeRange: params.timeRange },
      filterFor: params.filterFor,
    });
  }

  async getNewCount(params: NewCountParams): Promise<number> {
    return this.repository.findCount({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      since: params.since,
      filterWhere: params.filterWhere,
    });
  }

  /**
   * The trace ids a filter selects, newest first, capped. What an Instant
   * Eval run started from the Explorer judges when its own dialect cannot
   * compile the filter.
   */
  async getTraceIds(params: TraceIdsParams): Promise<string[]> {
    return this.repository.findTraceIds({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      ...(params.filterWhere ? { filterWhere: params.filterWhere } : {}),
      limit: params.limit,
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
