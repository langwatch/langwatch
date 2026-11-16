import { clickhouseRead, cond, fn, param } from "@langwatch/clickhouse-client/builder";
import { EVENT_METRICS_PREFIX } from "@langwatch/trace-contract";

import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../../rules/trace-facet-registry.rules.ts";
import {
  ClickHouseTraceFacetQueryRepository,
  KEY_DISCOVERY_SETTINGS,
} from "./clickhouse.trace-facet-query.repository.ts";
import { FACET_SOURCES, facetRows, facetScopeOf } from "./clickhouse.trace-facet-scope.mapper.ts";

/** Per-event cap on (metric key, value) buckets returned to the sidebar. */
const METRIC_VALUES_TOP_N = 10;

class ClickHouseTraceFacetEventsRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetEventsRepository {
    return new ClickHouseTraceFacetEventsRepository(ClickHouseTraceFacetQueryRepository.create());
  }

  /**
   * Discovers event names and their metric value aggregates in one query: each event's
   * non-empty `event.metrics.*` attributes as `<key>\x1F<value>` buckets, counted per name.
   */
  buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const scope = facetScopeOf(ctx);
    const names = storedSpans["Events.Name"];
    const spanEvents = facetRows({ source: FACET_SOURCES.stored_spans, scan: ctx, scope })
      .where(() => cond.gt(fn.length(names), 0), { inElection: false })
      .select({ ev: fn.arrayJoin(fn.arrayZip(names, storedSpans["Events.Attributes"])) })
      .as("span_events");
    const name = fn.toString(fn.tupleElement(spanEvents.ev, "0"));
    const attributes = fn.tupleElement(spanEvents.ev, "1");
    const entries = clickhouseRead({ scope })
      .from(spanEvents)
      .where(() => cond.ne(name, ""))
      .select({
        name,
        metric_entries: fn.arrayFilter(
          (entry) =>
            cond.and(
              fn.startsWith(fn.tupleElement(entry, "0"), EVENT_METRICS_PREFIX),
              cond.ne(fn.toString(fn.tupleElement(entry, "1")), ""),
            ),
          fn.arrayZip(fn.mapKeys(attributes), fn.mapValues(attributes)),
        ),
      })
      .as("event_entries");
    const named = clickhouseRead({ scope })
      .from(entries)
      .where(() => this.facetQueries.prefixed(entries.name, ctx.prefix))
      .select({
        event_name: entries.name,
        cnt: fn.count(),
        metric_buckets: fn.sumMap(
          fn.arrayMap(
            (entry) =>
              fn.concat(fn.tupleElement(entry, "0"), fn.char(31), fn.tupleElement(entry, "1")),
            entries.metric_entries,
          ),
          fn.arrayMap(() => param.uint64(1), entries.metric_entries),
        ),
      })
      .groupBy(entries.name)
      .as("named_events");
    return (
      clickhouseRead({ scope })
        .from(named)
        .select({
          facet_value: named.event_name,
          cnt: named.cnt,
          metric_values: fn.arraySlice(
            fn.arrayReverseSortBy(
              (bucket) => fn.tupleElement(bucket, "1"),
              fn.arrayZip(
                fn.tupleElement(named.metric_buckets, "0"),
                fn.tupleElement(named.metric_buckets, "1"),
              ),
            ),
            1,
            METRIC_VALUES_TOP_N,
          ),
          total_distinct: fn.over(fn.count(), {}),
        })
        .orderBy("cnt", "DESC")
        .limit(ctx.limit)
        .offset(ctx.offset)
        // Zipping and flattening Events.Attributes over the window needs the spill and memory cap.
        .settings(KEY_DISCOVERY_SETTINGS)
        .build()
    );
  }
}

const eventsFacetRepository = ClickHouseTraceFacetEventsRepository.create();

export const EVENT_FACET: QueryBuilderCategoricalDef = {
  key: "event",
  kind: "categorical",
  label: "Event name",
  group: "span",
  table: "stored_spans",
  queryBuilder: (ctx) => eventsFacetRepository.buildEventsFacetQuery(ctx),
};
