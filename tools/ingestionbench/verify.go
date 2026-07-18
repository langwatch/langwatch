package ingestionbench

// Correctness verification for the ingestion benchmark.
//
// This file is the POINT of the benchmark. Resource curves are decoration;
// these assertions are what can actually fail the run.
//
// Three things are checked after every stage:
//
//  1. NO LOST SPANS — every span the receiver accepted is stored.
//  2. NO DOUBLE COUNTING — trace_summaries.SpanCount equals the number of
//     distinct spans actually stored for that trace. Four fold projections
//     accumulate, and a retried batch that re-applies is the failure mode
//     this whole exercise exists to catch. It is invisible to a span count
//     on its own, because the spans are all there — only the COUNTER is
//     wrong.
//  3. NO CROSS-TENANT LEAKAGE — no tenant's trace appears under another.
//
// Query builders and verdict logic are kept pure and separately unit-tested;
// only the driver touches a ClickHouse client.
//
// ClickHouse conventions (see dev/docs/best_practices/clickhouse-queries.md):
//   - TenantId is always the first predicate.
//   - trace_summaries is a ReplacingMergeTree, so the latest version is read
//     with argMax(col, UpdatedAt) — never max(col), which can mix versions.
//   - The partition-key column is always range-bounded so ClickHouse prunes
//     partitions instead of scanning every week including cold storage.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// clickhouseCount is an integer column that the ClickHouse JSON interface may
// render either as a JSON number or as a quoted string (Int64/UInt64 are
// stringified). Decoding both shapes into an int64 up front is what keeps the
// comparisons below numeric: a lexical compare would call "9" greater than
// "50" and invent a violation that does not exist.
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
  `
}

// EventLogCountsQuery returns distinct recordSpan events per trace, straight
// from the durable log.
//
// event_log is ground truth for "did the span become an event at all",
// independent of any projection's lag or health. Comparing the three layers —
// event_log, then trace_summaries, then stored_spans — localises a regression
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

// ViolationKind classifies a correctness violation.
type ViolationKind string

const (
	ViolationLostSpans       ViolationKind = "lost-spans"
	ViolationDoubleCounted   ViolationKind = "double-counted"
	ViolationUnderCounted    ViolationKind = "under-counted"
	ViolationMissingSummary  ViolationKind = "missing-summary"
	ViolationCrossTenantLeak ViolationKind = "cross-tenant-leak"
)

// Violation is a single failed correctness assertion.
//
// TraceId, Expected and Actual are optional: kinds that are not about a count
// (missing-summary, cross-tenant-leak) leave the counts at their zero value.
type Violation struct {
	Kind     ViolationKind
	TenantId string
	TraceId  string
	Expected int
	Actual   int
	Detail   string
}

// sortedKeys returns a map's keys in ascending order.
//
// Go map iteration is randomised, so every rule below walks its input in a
// deterministic order. Two runs over the same data must produce the same
// violation list — the detail dump is capped at ten entries, and a shuffled
// cap would show a different ten every time.
func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// FindLostSpansOptions are the inputs to FindLostSpans.
type FindLostSpansOptions struct {
	TenantId string
	// ExpectedPerTrace must be built from ACCEPTED spans. Treat as read-only.
	ExpectedPerTrace map[string]int
	// StoredPerTrace is the distinct stored span count per trace. Read-only.
	StoredPerTrace map[string]int
}

// FindLostSpans compares spans accepted by the receiver against spans stored,
// per trace.
//
// ExpectedPerTrace must be built from ACCEPTED spans — the receiver can
// return 2xx while rejecting spans in partialSuccess.rejectedSpans, and
// counting those as sent would report phantom data loss.
func FindLostSpans(opts FindLostSpansOptions) []Violation {
	violations := []Violation{}
	for _, traceId := range sortedKeys(opts.ExpectedPerTrace) {
		expected := opts.ExpectedPerTrace[traceId]
		actual := opts.StoredPerTrace[traceId]
		if actual < expected {
			violations = append(violations, Violation{
				Kind:     ViolationLostSpans,
				TenantId: opts.TenantId,
				TraceId:  traceId,
				Expected: expected,
				Actual:   actual,
				Detail: fmt.Sprintf("accepted %d spans, stored %d (%d lost)",
					expected, actual, expected-actual),
			})
		}
	}
	return violations
}

// FindCountMismatchesOptions are the inputs to FindCountMismatches.
type FindCountMismatchesOptions struct {
	TenantId string
	// Rows are the summaryVsStoredQuery rows. Treat as read-only.
	Rows []SummaryRow
}

// FindCountMismatches compares each summary's SpanCount against the spans
// actually stored.
//
// Over-count is the retry/re-fold bug. Under-count is a dropped or stalled
// fold. Both are reported, because both mean the projection disagrees with
// the event log.
func FindCountMismatches(opts FindCountMismatchesOptions) []Violation {
	violations := []Violation{}
	for _, row := range opts.Rows {
		summaryCount := int(row.SpanCount)
		storedCount := int(row.StoredSpans)
		switch {
		case summaryCount > storedCount:
			violations = append(violations, Violation{
				Kind:     ViolationDoubleCounted,
				TenantId: opts.TenantId,
				TraceId:  row.TraceId,
				Expected: storedCount,
				Actual:   summaryCount,
				Detail: fmt.Sprintf(
					"trace_summaries.SpanCount is %d but only %d distinct spans "+
						"are stored — the fold counted %d span(s) more than once",
					summaryCount, storedCount, summaryCount-storedCount),
			})
		case summaryCount < storedCount:
			violations = append(violations, Violation{
				Kind:     ViolationUnderCounted,
				TenantId: opts.TenantId,
				TraceId:  row.TraceId,
				Expected: storedCount,
				Actual:   summaryCount,
				Detail: fmt.Sprintf(
					"trace_summaries.SpanCount is %d but %d distinct spans "+
						"are stored — %d span(s) never reached the fold",
					summaryCount, storedCount, storedCount-summaryCount),
			})
		}
	}
	return violations
}

// FindMissingSummariesOptions are the inputs to FindMissingSummaries.
type FindMissingSummariesOptions struct {
	TenantId string
	// ExpectedTraceIds are the traces the driver sent. Treat as read-only.
	ExpectedTraceIds []string
	// SummarisedTraceIds are the traces that produced a summary. Read-only.
	SummarisedTraceIds map[string]struct{}
}

// FindMissingSummaries reports traces the driver sent that produced no summary
// row at all.
func FindMissingSummaries(opts FindMissingSummariesOptions) []Violation {
	violations := []Violation{}
	for _, traceId := range opts.ExpectedTraceIds {
		if _, ok := opts.SummarisedTraceIds[traceId]; ok {
			continue
		}
		violations = append(violations, Violation{
			Kind:     ViolationMissingSummary,
			TenantId: opts.TenantId,
			TraceId:  traceId,
			Detail:   "no trace_summaries row was produced for this trace",
		})
	}
	return violations
}

// FindCrossTenantLeaksOptions are the inputs to FindCrossTenantLeaks.
type FindCrossTenantLeaksOptions struct {
	TenantId string
	// ForeignTraceIds come from ForeignTracesQuery. Treat as read-only.
	ForeignTraceIds []string
}

// FindCrossTenantLeaks reports traces found under a tenant that the driver
// never sent there.
func FindCrossTenantLeaks(opts FindCrossTenantLeaksOptions) []Violation {
	violations := []Violation{}
	for _, traceId := range opts.ForeignTraceIds {
		violations = append(violations, Violation{
			Kind:     ViolationCrossTenantLeak,
			TenantId: opts.TenantId,
			TraceId:  traceId,
			Detail: fmt.Sprintf("trace %s is stored under tenant %s but was never sent to it",
				traceId, opts.TenantId),
		})
	}
	return violations
}

// FindLayerDivergenceOptions are the inputs to FindLayerDivergence.
type FindLayerDivergenceOptions struct {
	TenantId string
	// Accepted, EventLog and StoredSpans are per-trace counts. Read-only.
	Accepted    map[string]int
	EventLog    map[string]int
	StoredSpans map[string]int
}

// FindLayerDivergence localises a shortfall to the layer that lost it.
//
// Reports at most ONE violation per trace — the earliest layer that went
// wrong. A span missing from event_log is also missing from stored_spans and
// from the summary, and emitting three violations for one root cause turns a
// readable summary into noise.
func FindLayerDivergence(opts FindLayerDivergenceOptions) []Violation {
	violations := []Violation{}
	for _, traceId := range sortedKeys(opts.Accepted) {
		expected := opts.Accepted[traceId]
		events := opts.EventLog[traceId]
		spans := opts.StoredSpans[traceId]

		switch {
		case events < expected:
			violations = append(violations, Violation{
				Kind:     ViolationLostSpans,
				TenantId: opts.TenantId,
				TraceId:  traceId,
				Expected: expected,
				Actual:   events,
				Detail: fmt.Sprintf(
					"INGEST layer: receiver accepted %d spans but only %d reached "+
						"event_log — %d never became an event",
					expected, events, expected-events),
			})
		case spans < events:
			violations = append(violations, Violation{
				Kind:     ViolationLostSpans,
				TenantId: opts.TenantId,
				TraceId:  traceId,
				Expected: events,
				Actual:   spans,
				Detail: fmt.Sprintf(
					"PROJECTION layer: %d events are in event_log but only %d spans were "+
						"stored — the map projection dropped %d",
					events, spans, events-spans),
			})
		}
	}
	return violations
}

// FindResendDriftOptions are the inputs to FindResendDrift.
type FindResendDriftOptions struct {
	TenantId string
	// Before and After are the per-trace SpanCount either side of the resend.
	// Treat as read-only.
	Before map[string]int
	After  map[string]int
}

// FindResendDrift asserts a resend did not move the counter.
//
// The ingest dedup lock should discard every resent span. A SpanCount that
// grew across a resend is the accumulation bug, caught directly.
func FindResendDrift(opts FindResendDriftOptions) []Violation {
	violations := []Violation{}
	for _, traceId := range sortedKeys(opts.Before) {
		beforeCount := opts.Before[traceId]
		afterCount := opts.After[traceId]
		if afterCount > beforeCount {
			violations = append(violations, Violation{
				Kind:     ViolationDoubleCounted,
				TenantId: opts.TenantId,
				TraceId:  traceId,
				Expected: beforeCount,
				Actual:   afterCount,
				Detail: fmt.Sprintf(
					"SpanCount rose from %d to %d after re-sending spans that "+
						"were already ingested — the dedup gate did not hold and the fold re-applied them",
					beforeCount, afterCount),
			})
		}
	}
	return violations
}

// IsFailure reports whether the run must fail. Any violation is a hard failure.
func IsFailure(violations []Violation) bool {
	return len(violations) > 0
}

// SummariseViolations renders a human-readable violation summary, grouped by
// kind, for the job summary.
func SummariseViolations(violations []Violation) string {
	if len(violations) == 0 {
		return "No correctness violations."
	}

	// Grouped in first-seen order: Go map iteration is randomised, and a
	// summary whose sections shuffle between runs is not diffable.
	order := []ViolationKind{}
	byKind := map[ViolationKind][]Violation{}
	for _, v := range violations {
		if _, seen := byKind[v.Kind]; !seen {
			order = append(order, v.Kind)
		}
		byKind[v.Kind] = append(byKind[v.Kind], v)
	}

	var b strings.Builder
	for i, kind := range order {
		if i > 0 {
			b.WriteString("\n")
		}
		list := byKind[kind]
		fmt.Fprintf(&b, "**%s** — %d occurrence(s)", kind, len(list))
		// Cap the detail dump; a systemic bug produces thousands of identical
		// lines and burying the summary helps nobody.
		capped := list
		if len(capped) > 10 {
			capped = capped[:10]
		}
		for _, v := range capped {
			trace := ""
			if v.TraceId != "" {
				trace = fmt.Sprintf(" trace `%s`", v.TraceId)
			}
			fmt.Fprintf(&b, "\n  - tenant `%s`%s: %s", v.TenantId, trace, v.Detail)
		}
		if len(list) > 10 {
			fmt.Fprintf(&b, "\n  - …and %d more", len(list)-10)
		}
	}
	return b.String()
}
