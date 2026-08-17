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
	"fmt"
	"sort"
	"strings"
)

// ViolationKind classifies a correctness violation.
type ViolationKind string

// The kinds, in the order a reader should care about them: losing a span and
// leaking one across tenants are the two that make the benchmark's answer
// worthless, and the counting kinds say by how much.
const (
	// ViolationLostSpans is a span that was accepted and never stored.
	ViolationLostSpans ViolationKind = "lost-spans"
	// ViolationDoubleCounted is a span stored more times than it was sent,
	// which is what a broken dedup looks like from the outside.
	ViolationDoubleCounted ViolationKind = "double-counted"
	// ViolationUnderCounted is a stored count below what was accepted, short of
	// outright loss.
	ViolationUnderCounted ViolationKind = "under-counted"
	// ViolationMissingSummary is a trace whose spans landed but which never
	// produced a summary, so the projection did not run.
	ViolationMissingSummary ViolationKind = "missing-summary"
	// ViolationCrossTenantLeak is one tenant's data visible under another's id.
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
// Go map iteration is randomized, so every rule below walks its input in a
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
	// SummarizedTraceIds are the traces that produced a summary. Read-only.
	SummarizedTraceIds map[string]struct{}
}

// FindMissingSummaries reports traces the driver sent that produced no summary
// row at all.
func FindMissingSummaries(opts FindMissingSummariesOptions) []Violation {
	violations := []Violation{}
	for _, traceId := range opts.ExpectedTraceIds {
		if _, ok := opts.SummarizedTraceIds[traceId]; ok {
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

// FindLayerDivergence localizes a shortfall to the layer that lost it.
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

		// Both directions, at both layers. A shortfall is loss and an excess is
		// duplication, and this benchmark exists to catch the second at least as
		// much as the first — reporting only shortfalls would let the exact
		// double-count the fold projections can produce pass silently.
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
		case events > expected:
			violations = append(violations, Violation{
				Kind:     ViolationDoubleCounted,
				TenantId: opts.TenantId,
				TraceId:  traceId,
				Expected: expected,
				Actual:   events,
				Detail: fmt.Sprintf(
					"INGEST layer: event_log holds %d span events but the receiver only "+
						"accepted %d — %d spans were recorded more than once",
					events, expected, events-expected),
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
		case spans > events:
			violations = append(violations, Violation{
				Kind:     ViolationDoubleCounted,
				TenantId: opts.TenantId,
				TraceId:  traceId,
				Expected: events,
				Actual:   spans,
				Detail: fmt.Sprintf(
					"PROJECTION layer: %d spans were stored from only %d events — the map "+
						"projection applied %d of them twice",
					spans, events, spans-events),
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

		// The contract is that the counter DID NOT MOVE, so both directions
		// fail. A resend that lowers the count, or makes the summary disappear
		// entirely, is a worse outcome than one that raises it — and checking
		// only for a rise would have called that a pass.
		switch {
		case afterCount > beforeCount:
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
		case afterCount < beforeCount:
			violations = append(violations, Violation{
				Kind:     ViolationLostSpans,
				TenantId: opts.TenantId,
				TraceId:  traceId,
				Expected: beforeCount,
				Actual:   afterCount,
				Detail: fmt.Sprintf(
					"SpanCount FELL from %d to %d after re-sending spans that were already "+
						"ingested — the resend destroyed data that had already landed",
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

// SummarizeViolations renders a human-readable violation summary, grouped by
// kind, for the job summary.
func SummarizeViolations(violations []Violation) string {
	if len(violations) == 0 {
		return "No correctness violations."
	}

	order, byKind := groupViolationsByKind(violations)

	var b strings.Builder
	for i, kind := range order {
		if i > 0 {
			b.WriteString("\n")
		}
		writeViolationGroup(&b, kind, byKind[kind])
	}
	return b.String()
}

// maxViolationsPerKind caps the detail dump. A systemic bug produces thousands
// of identical lines, and burying the summary under them helps nobody.
const maxViolationsPerKind = 10

// groupViolationsByKind groups violations, keeping first-seen order.
//
// The order matters because Go map iteration is randomized, and a summary whose
// sections shuffle between runs is not diffable.
func groupViolationsByKind(violations []Violation) ([]ViolationKind, map[ViolationKind][]Violation) {
	order := []ViolationKind{}
	byKind := map[ViolationKind][]Violation{}
	for _, v := range violations {
		if _, seen := byKind[v.Kind]; !seen {
			order = append(order, v.Kind)
		}
		byKind[v.Kind] = append(byKind[v.Kind], v)
	}
	return order, byKind
}

// writeViolationGroup renders one kind's heading and its capped detail lines.
func writeViolationGroup(b *strings.Builder, kind ViolationKind, list []Violation) {
	fmt.Fprintf(b, "**%s** — %d occurrence(s)", kind, len(list))

	capped := list
	if len(capped) > maxViolationsPerKind {
		capped = capped[:maxViolationsPerKind]
	}
	for _, v := range capped {
		trace := ""
		if v.TraceId != "" {
			trace = fmt.Sprintf(" trace `%s`", v.TraceId)
		}
		fmt.Fprintf(b, "\n  - tenant `%s`%s: %s", v.TenantId, trace, v.Detail)
	}

	if len(list) > maxViolationsPerKind {
		fmt.Fprintf(b, "\n  - …and %d more", len(list)-maxViolationsPerKind)
	}
}
