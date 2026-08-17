package ingestionbench

// The ClickHouse reads the correctness checks are built on: the row shapes
// they decode into and the statements that produce them.
//
// Every statement binds its values as query parameters rather than
// interpolating them, so a tenant id can never become query syntax.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type clickhouseCount int64

// UnmarshalJSON accepts both `50` and `"50"`.
func (c *clickhouseCount) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"' {
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil {
			return err
		}
		n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		if err != nil {
			return fmt.Errorf("clickhouse count %q is not an integer: %w", s, err)
		}
		*c = clickhouseCount(n)
		return nil
	}
	var n int64
	if err := json.Unmarshal(trimmed, &n); err != nil {
		return err
	}
	*c = clickhouseCount(n)
	return nil
}

// StoredSpanCount is one row of storedSpansPerTraceQuery.
type StoredSpanCount struct {
	TraceId   string          `json:"TraceId"`
	SpanCount clickhouseCount `json:"SpanCount"`
}

// SummaryRow is one row of summaryVsStoredQuery.
type SummaryRow struct {
	TraceId     string          `json:"TraceId"`
	SpanCount   clickhouseCount `json:"SpanCount"`
	StoredSpans clickhouseCount `json:"StoredSpans"`
}

// TimeWindow bounds a verification query.
type TimeWindow struct {
	// FromMs is the inclusive lower bound, ms since epoch.
	FromMs int64
	// ToMs is the inclusive upper bound, ms since epoch.
	ToMs int64
}

// StoredSpansPerTraceQuery returns distinct stored spans per trace for one
// tenant.
//
// stored_spans is ORDER BY (TenantId, TraceId, SpanId) so duplicate inserts
// collapse on merge — but merges are asynchronous, so an unmerged duplicate
// would inflate a naive count(). countDistinct(SpanId) is therefore the
// merge-independent way to ask "how many spans are really here".
func StoredSpansPerTraceQuery() string {
	return `
    SELECT
      TraceId,
      countDistinct(SpanId) AS SpanCount
    FROM stored_spans
    WHERE TenantId = {tenantId:String}
      AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})
      AND StartTime <= fromUnixTimestamp64Milli({toMs:Int64})
      AND TraceId IN {traceIds:Array(String)}
    GROUP BY TraceId
  `
}

// SummaryVsStoredQuery returns the summary's own SpanCount alongside the real
// stored span count, per trace.
//
// The two are computed independently and compared in FindCountMismatches. A
// summary that says 120 when 100 spans exist is a double-count; a summary that
// says 80 is a dropped fold.
func SummaryVsStoredQuery() string {
	return `
    SELECT
      s.TraceId AS TraceId,
      s.SpanCount AS SpanCount,
      ifNull(sp.StoredSpans, 0) AS StoredSpans
    FROM
    (
      SELECT
        TraceId,
        argMax(SpanCount, UpdatedAt) AS SpanCount
      FROM trace_summaries
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
        AND OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})
        AND TraceId IN {traceIds:Array(String)}
      GROUP BY TraceId
    ) AS s
    LEFT JOIN
    (
      SELECT
        TraceId,
        countDistinct(SpanId) AS StoredSpans
      FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})
        AND StartTime <= fromUnixTimestamp64Milli({toMs:Int64})
        AND TraceId IN {traceIds:Array(String)}
      GROUP BY TraceId
    ) AS sp
    ON s.TraceId = sp.TraceId
  `
}

// ForeignTracesQuery returns traces stored under a tenant that the driver never
// sent to that tenant.
//
// Asked as "what is here that should NOT be" rather than "is what I sent
// here", because leakage is by definition data you did not put there. A query
// shaped the other way round cannot see it.
func ForeignTracesQuery() string {
	return `
    SELECT DISTINCT TraceId
    FROM stored_spans
    WHERE TenantId = {tenantId:String}
      AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})
      AND StartTime <= fromUnixTimestamp64Milli({toMs:Int64})
      AND TraceId NOT IN {ownTraceIds:Array(String)}
    LIMIT ` + strconv.Itoa(ForeignTraceSampleLimit) + `
  `
}

// ForeignTraceSampleLimit bounds the cross-tenant read.
//
// The verdict is binary — either something leaked or nothing did — so the query
// only has to prove it happened and show enough examples to chase. Unbounded,
// a genuine break, or a window overlapping another run in the same database,
// returns every foreign trace: one Violation each, each with its own formatted
// Detail, all of them serialised into results.json. The summary caps what it
// PRINTS at ten; nothing capped what was collected.
const ForeignTraceSampleLimit = 100

// EventLogCountsQuery returns distinct recordSpan events per trace, straight
// from the durable log.
//
// event_log is ground truth for "did the span become an event at all",
// independent of any projection's lag or health. Comparing the three layers —
// event_log, then trace_summaries, then stored_spans — localizes a regression
// precisely:
//
//	accepted > event_log            → the span never became an event (ingest)
//	event_log > stored_spans        → the map projection dropped it
//	summary  != stored_spans        → the fold disagrees with reality
//
// Without this layer, all three failures look identical from the outside.
//
// The EventType is parameterised rather than hardcoded: the trace aggregate
// carries several command types (recordSpan, recordLog, assignTopic, …) and
// counting all of them would not equal the span count. The caller passes the
// span-recording type so this stays correct if the type string is renamed.
//
// Note the time bounds are on EventOccurredAt, which for a span event is the
// INGEST wall-clock (now), not the span's start time — so the window here is
// the run window, NOT the synthetic span timestamps used against
// stored_spans.StartTime and trace_summaries.OccurredAt.
func EventLogCountsQuery() string {
	return `
    SELECT
      AggregateId AS TraceId,
      countDistinct(EventId) AS EventCount
    FROM event_log
    WHERE TenantId = {tenantId:String}
      AND AggregateType = 'trace'
      AND EventType = {eventType:String}
      AND EventOccurredAt >= {fromMs:Int64}
      AND EventOccurredAt <= {toMs:Int64}
      AND AggregateId IN {traceIds:Array(String)}
    GROUP BY AggregateId
  `
}
