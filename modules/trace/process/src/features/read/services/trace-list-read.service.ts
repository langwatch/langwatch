import { type Authorization, ownProjectIdReadBy } from "@langwatch/authorization";
import type { PresenceApi } from "@langwatch/presence-contract";
import {
  TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
  TRACE_LIST_MAX_OFFSET_ROWS,
  PageTooDeepError,
  listedTraceKey,
  teaserOf,
} from "@langwatch/trace-contract";
import type {
  DiscoverResult,
  FacetDescriptor,
  FacetValuesResult,
  TraceListCursor,
  TraceListItem,
  TraceListPage,
  TraceListRead,
  TraceRef,
  Protections,
} from "@langwatch/trace-contract";

import type { FacetCatalog } from "#features/facet/rules/trace-facet-registry.rules";

import type { TraceEvaluationRunsReadRepository } from "../../../repositories/trace-evaluation-runs.repository.ts";
import type {
  DiscoverParams,
  FacetValuesParams,
} from "../../../rules/trace-list-cache-key.rules.ts";
import {
  cursorForTraceRow,
  mapToTraceListItem,
  SORT_COLUMN_MAP,
} from "../../../rules/trace-list-row.rules.ts";
import { TraceDiscoverService } from "../../../services/trace-discover.service.ts";
import type { FacetFilterResolver } from "../../facet/rules/trace-facet-filter.rules.ts";
import { TraceFacetValuesService } from "../../facet/services/trace-facet-values.service.ts";
import type { TraceTopicNamesReadRepository } from "../../topic/repositories/trace-topic-names.repository.ts";
import { TraceTopicNamingService } from "../../topic/services/trace-topic-naming.service.ts";

interface ListParams {
  authorization: Authorization;
  timeRange: { from: number; to: number };
  sort: { columnId: string; direction: "asc" | "desc" };
  /** 1-based offset compatibility for non-cursor callers. */
  page?: number;
  pageSize: number;
  /** A cursor minted before it carried its tenant reads as the proof's own project. */
  cursor?: Omit<TraceListCursor, "tenantId"> & { tenantId?: string };
  filterWhere?: { sql: string; params: Record<string, unknown> };
  /**
   * Visibility gate: list items older than this cutoff get their
   * input/output previews teaser-redacted. Omitted/null = ungated.
   */
  visibilityCutoffMs?: number | null;
}

interface FacetParams {
  authorization: Authorization;
  /** The exact window the list reads, never snapped. */
  timeRange: { from: number; to: number; live?: boolean };
  /** The predicate each facet is counted under. */
  filterFor: FacetFilterResolver;
}

interface NewCountParams {
  authorization: Authorization;
  timeRange: { from: number; to: number };
  since: number;
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

interface TraceIdsParams {
  authorization: Authorization;
  timeRange: { from: number; to: number };
  filterWhere?: { sql: string; params: Record<string, unknown> };
  limit: number;
}

interface SuggestParams {
  authorization: Authorization;
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
    evaluationRuns,
    topicNames,
    facets,
    discoverUpdates,
  }: {
    repository: TraceListRead;
    /** Evaluation's shared runs, read for each page's evaluation summaries (R40). */
    evaluationRuns: Pick<TraceEvaluationRunsReadRepository, "findSummariesByTraceIds">;
    /** Trace's fold of topic's names; facet labels read it. */
    topicNames: Pick<TraceTopicNamesReadRepository, "findNamesByIds">;
    facets: FacetCatalog;
    /** Where a finished background discover refresh tells the tenant's tabs to refetch. */
    discoverUpdates: Pick<PresenceApi, "publishProjectEvent">;
  }): TraceListService {
    const topicNaming = TraceTopicNamingService.create({ topicNames });

    return new TraceListService({
      repository,
      evaluationRuns,
      discover: TraceDiscoverService.create({
        repository,
        topicNaming,
        facets,
        updates: discoverUpdates,
      }),
      facetValues: TraceFacetValuesService.create({ repository, topicNaming, facets }),
    });
  }

  private readonly repository: TraceListRead;

  private readonly evaluationRuns: Pick<
    TraceEvaluationRunsReadRepository,
    "findSummariesByTraceIds"
  >;

  private readonly discover: TraceDiscoverService;

  private readonly facetValues: TraceFacetValuesService;

  private constructor(deps: {
    repository: TraceListRead;

    evaluationRuns: Pick<TraceEvaluationRunsReadRepository, "findSummariesByTraceIds">;

    discover: TraceDiscoverService;

    facetValues: TraceFacetValuesService;
  }) {
    this.repository = deps.repository;

    this.evaluationRuns = deps.evaluationRuns;

    this.discover = deps.discover;

    this.facetValues = deps.facetValues;
  }

  /** The cached facet discovery for the sidebar. */
  getDiscover(params: DiscoverParams): Promise<DiscoverResult> {
    return this.discover.getDiscover(params);
  }

  /** One facet's values, cached, for a sidebar drill-in. */
  /** The facet-store key a REST `field` names, judged against this list's facet catalogue. */
  resolveFacetKey(input: { field: string; protections: Protections }): string {
    return this.facetValues.resolveFacetKey(input);
  }

  getFacetValues(params: FacetValuesParams): Promise<FacetValuesResult> {
    return this.facetValues.getFacetValues(params);
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
      input: item.input ? teaserOf(item.input) : item.input,
      output: item.output ? teaserOf(item.output) : item.output,
      error: item.error ? teaserOf(item.error) : item.error,
      labels: item.labels.map((label) => teaserOf(label)),
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

    const result = await this.repository.listAll({
      authorization: params.authorization,
      timeRange: params.timeRange,
      sort: { column: sortColumn, direction: params.sort.direction },
      // Read one sentinel row so `nextCursor` is exact without guessing from
      // totalHits (which may change under a live range between requests).
      limit: params.pageSize + 1,
      cursor: params.cursor
        ? {
            sortValue: params.cursor.sortValue,
            tenantId: params.cursor.tenantId ?? ownProjectIdReadBy(params.authorization),
            traceId: params.cursor.traceId,
          }
        : undefined,
      offset,
      filterWhere: params.filterWhere,
    });

    const hasMore = result.rows.length > params.pageSize;
    const visibleRows = hasMore ? result.rows.slice(0, params.pageSize) : result.rows;
    const evaluations = evaluationsByListedRow(
      await this.evaluationRuns.findSummariesByTraceIds({
        authorization: params.authorization,
        // Two members may list the same id; the read needs it once.
        traceIds: [...new Set(visibleRows.map((row) => row.traceId))],
        since: params.timeRange.from,
      }),
    );
    const items = visibleRows.map((row) => ({
      ...mapToTraceListItem(row),
      evaluations:
        evaluations.get(listedTraceKey({ projectId: row.tenantId, traceId: row.traceId })) ?? [],
    }));

    const gatedItems = TraceListService.#gateItems(items, params.visibilityCutoffMs);

    return {
      items: gatedItems,
      totalHits: result.totalHits,
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
      params: { authorization: params.authorization, timeRange: params.timeRange },
      filterFor: params.filterFor,
    });
  }

  async getNewCount(params: NewCountParams): Promise<number> {
    return this.repository.findCount({
      authorization: params.authorization,
      timeRange: params.timeRange,
      since: params.since,
      filterWhere: params.filterWhere,
    });
  }

  /**
   * The traces a filter selects, newest first, capped, each named by tenant and
   * trace id. What an Instant Eval run started from the Explorer judges when its
   * own dialect cannot compile the filter.
   */
  async getTraceRefs(params: TraceIdsParams): Promise<TraceRef[]> {
    return this.repository.findTraceRefs({
      authorization: params.authorization,
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
      authorization: params.authorization,
      column,
      prefix: params.prefix,
      limit: params.limit ?? 20,
    });
  }
}

type ListedEvaluation = TraceListItem["evaluations"][number];

/**
 * A page's evaluations keyed by tenant and trace id together: on an aggregate two
 * members may hold the same id, and the pair keeps one member's evaluation off the
 * other's row (ADR-177).
 */
function evaluationsByListedRow(
  evaluations: readonly (ListedEvaluation & { tenantId: string })[],
): Map<string, ListedEvaluation[]> {
  const byRow = new Map<string, ListedEvaluation[]>();
  for (const { tenantId, ...summary } of evaluations) {
    const key = listedTraceKey({ projectId: tenantId, traceId: summary.traceId ?? "" });
    byRow.set(key, [...(byRow.get(key) ?? []), summary]);
  }
  return byRow;
}
