/**
 * Top RAG documents and thumbs feedback, built on the typed builder (ADR-202): each trace's latest
 * version in the window, the dashboard filters on it, joined to its spans by tenant and trace.
 */
import type { AnalyticsFeedbackPosition } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  column,
  fn,
  param,
  type ProofScope,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import { ANALYTICS_CLICKHOUSE_SETTINGS } from "../../rules/clickhouse-settings.rules.ts";
import type { AnalyticsLegacyReadInput } from "../analytics.repository.ts";
import {
  type AnalyticsFilterInput,
  analyticsFilterCondition,
  type SpanWindow,
} from "./clickhouse.filter-conditions.mapper.ts";
import { storedSpans } from "./clickhouse.stored-spans.table.ts";
import { traceSummaries } from "./clickhouse.trace-summaries.table.ts";

/** The span attribute RAG spans record their retrieved documents in. */
const RAG_CONTEXTS_ATTRIBUTE = "langwatch.rag.contexts";
const FEEDBACK_EVENT = "thumbs_up_down";
const VOTE_ATTRIBUTE = "event.metrics.vote";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const FEEDBACK_LIST_LIMIT = 100;
const TOP_DOCUMENTS_LIMIT = 10;

type WindowedRead = {
  scope: ProofScope;
  window: SpanWindow;
  filters: AnalyticsLegacyReadInput["filters"];
};

/** Each trace's latest version that occurred in the window and passes the dashboard filters. */
function filteredTraces({ scope, window, filters }: WindowedRead) {
  const ts = traceSummaries;
  return clickhouseRead({ scope })
    .from(ts)
    .withinWindows()
    .select({ TenantId: ts.TenantId, TraceId: ts.TraceId })
    .where(({ and, gte, lt }) =>
      and(gte(ts.OccurredAt, window.startMs), lt(ts.OccurredAt, window.endMs)),
    )
    .where(
      analyticsFilterCondition({
        filters: (filters ?? {}) as AnalyticsFilterInput,
        ts,
        spanWindow: window,
      }),
      { inElection: false },
    )
    .latestVersion()
    .as("ts");
}

/** Span rows in the window two days wider, as the span join pruned them; every version joins. */
function windowedSpans({ scope, window }: Pick<WindowedRead, "scope" | "window">) {
  const ss = storedSpans;
  return clickhouseRead({ scope })
    .from(ss)
    .withinWindows()
    .where(({ and, gte, lt }) =>
      and(
        gte(ss.StartTime, window.startMs - TWO_DAYS_MS),
        lt(ss.StartTime, window.endMs + TWO_DAYS_MS),
      ),
    );
}

/**
 * The ten documents most often retrieved, each with one trace and its content, and the distinct
 * document total in every row (`count() OVER ()` counts the groups before the LIMIT).
 */
export function topDocumentsRead(read: WindowedRead): ReaderReadStatement {
  const { scope } = read;
  const traces = filteredTraces(read);
  const spans = windowedSpans(read)
    .select({
      TenantId: storedSpans.TenantId,
      TraceId: storedSpans.TraceId,
      contexts: fn.mapGet(storedSpans.SpanAttributes, RAG_CONTEXTS_ATTRIBUTE),
    })
    .where(({ ne }) => ne(fn.mapGet(storedSpans.SpanAttributes, RAG_CONTEXTS_ATTRIBUTE), ""))
    .as("ss");
  const context = fn.arrayJoin(fn.JSONExtract(spans.contexts, column.array(column.json())));
  const refs = clickhouseRead({ scope })
    .from(traces)
    .innerJoin(spans, ({ and, eq }) =>
      and(eq(traces.TenantId, spans.TenantId), eq(traces.TraceId, spans.TraceId)),
    )
    .select({
      TraceId: traces.TraceId,
      document_id: fn.toString(fn.getSubcolumn(context, "document_id")),
      content: fn.toString(fn.getSubcolumn(context, "content")),
    })
    .as("document_refs");
  return clickhouseRead({ scope })
    .from(refs)
    .select({
      documentId: refs.document_id,
      count: fn.count(),
      trace_id: fn.any(refs.TraceId),
      content: fn.any(refs.content),
      total: fn.over(fn.count(), {}),
    })
    .where(({ ne }) => ne(refs.document_id, ""))
    .groupBy(refs.document_id)
    .orderBy("count", "DESC")
    .limit(TOP_DOCUMENTS_LIMIT)
    .settings(ANALYTICS_CLICKHOUSE_SETTINGS)
    .build() as ReaderReadStatement;
}

/** Thumbs feedback events, newest first; a page adds each event's index for a total order. */
function feedbackRead({
  read,
  page,
}: {
  read: WindowedRead;
  page?: { after?: AnalyticsFeedbackPosition; limit: number };
}): ReaderReadStatement {
  const { scope } = read;
  const traces = filteredTraces(read);
  const spans = windowedSpans(read)
    .select({
      TenantId: storedSpans.TenantId,
      TraceId: storedSpans.TraceId,
      SpanId: storedSpans.SpanId,
      eventTimes: storedSpans["Events.Timestamp"],
      eventNames: storedSpans["Events.Name"],
      eventAttributes: storedSpans["Events.Attributes"],
    })
    .as("ss");
  const event = fn.arrayJoin(
    fn.arrayZip(
      spans.eventTimes,
      fn.arrayEnumerate(spans.eventTimes),
      spans.eventNames,
      spans.eventAttributes,
    ),
  );
  const startedAt = fn.toUnixTimestamp64Milli(fn.tupleElement(event, "0"));
  const eventIndex = fn.tupleElement(event, "1");
  const eventName = fn.tupleElement(event, "2");
  const attributes = fn.tupleElement(event, "3");
  const base = clickhouseRead({ scope })
    .from(traces)
    .innerJoin(spans, ({ and, eq }) =>
      and(eq(traces.TenantId, spans.TenantId), eq(traces.TraceId, spans.TraceId)),
    )
    .select({
      trace_id: traces.TraceId,
      event_id: spans.SpanId,
      started_at: startedAt,
      ...(page ? { event_index: eventIndex } : {}),
      event_type: eventName,
      attributes,
    })
    .where(({ and, eq }) =>
      and(eq(eventName, param.string(FEEDBACK_EVENT)), fn.mapContains(attributes, VOTE_ATTRIBUTE)),
    );
  if (!page) {
    return base
      .orderBy(fn.tupleElement(event, "0"), "DESC")
      .limit(FEEDBACK_LIST_LIMIT)
      .settings(ANALYTICS_CLICKHOUSE_SETTINGS)
      .build() as ReaderReadStatement;
  }
  const { after } = page;
  const cursored = after
    ? base.where(({ lt }) =>
        lt(
          fn.tuple(startedAt, traces.TraceId, spans.SpanId, eventIndex),
          fn.tuple(
            param.int64(after.startedAt),
            param.string(after.traceId),
            param.string(after.spanId),
            param.uint32(after.eventIndex),
          ),
        ),
      )
    : base;
  return cursored
    .orderBy(fn.tupleElement(event, "0"), "DESC")
    .orderBy(traces.TraceId, "DESC")
    .orderBy(spans.SpanId, "DESC")
    .orderBy(eventIndex, "DESC")
    .limit(page.limit + 1)
    .settings(ANALYTICS_CLICKHOUSE_SETTINGS)
    .build() as ReaderReadStatement;
}

/** The latest hundred feedback events in the window. */
export function feedbacksRead(read: WindowedRead): ReaderReadStatement {
  return feedbackRead({ read });
}

/** A page of {@link feedbacksRead}'s events, one row more than `limit` to know another follows. */
export function feedbacksPageRead(
  read: WindowedRead & { after?: AnalyticsFeedbackPosition; limit: number },
): ReaderReadStatement {
  return feedbackRead({ read, page: { after: read.after, limit: read.limit } });
}
