package ingestionbench

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func traceIdSet(ids ...string) map[string]struct{} {
	s := map[string]struct{}{}
	for _, id := range ids {
		s[id] = struct{}{}
	}
	return s
}

func TestQueryBuilders(t *testing.T) {
	queries := map[string]string{
		"storedSpansPerTrace": StoredSpansPerTraceQuery(),
		"summaryVsStored":     SummaryVsStoredQuery(),
		"foreignTraces":       ForeignTracesQuery(),
		"eventLogCounts":      EventLogCountsQuery(),
	}

	t.Run("given the multitenancy rule", func(t *testing.T) {
		t.Run("filters every query on TenantId", func(t *testing.T) {
			for name, sql := range queries {
				if !strings.Contains(sql, "TenantId = {tenantId:String}") {
					t.Errorf("%s must filter on TenantId", name)
				}
			}
		})
	})

	t.Run("given the partition-pruning rule", func(t *testing.T) {
		t.Run("range-bounds the partition-key column in every query", func(t *testing.T) {
			// stored_spans partitions on StartTime, trace_summaries on OccurredAt,
			// event_log on EventOccurredAt. Without a range predicate ClickHouse
			// scans every partition including cold storage.
			cases := []struct{ query, want string }{
				{"storedSpansPerTrace", "StartTime >="},
				{"foreignTraces", "StartTime >="},
				{"summaryVsStored", "OccurredAt >="},
				{"eventLogCounts", "EventOccurredAt >="},
			}
			for _, c := range cases {
				if !strings.Contains(queries[c.query], c.want) {
					t.Errorf("%s must contain %q", c.query, c.want)
				}
			}
		})
	})

	t.Run("given trace_summaries is a ReplacingMergeTree", func(t *testing.T) {
		t.Run("reads the latest version with argMax rather than max", func(t *testing.T) {
			if !strings.Contains(queries["summaryVsStored"], "argMax(SpanCount, UpdatedAt)") {
				t.Errorf("summaryVsStored must read the counter with argMax")
			}
		})

		t.Run("never uses max() on the counter, which can mix versions", func(t *testing.T) {
			if strings.Contains(queries["summaryVsStored"], "max(SpanCount)") {
				t.Errorf("summaryVsStored must not use max(SpanCount)")
			}
		})
	})

	t.Run("given stored_spans may hold unmerged duplicates", func(t *testing.T) {
		t.Run("counts distinct span ids rather than rows", func(t *testing.T) {
			if !strings.Contains(queries["storedSpansPerTrace"], "countDistinct(SpanId)") {
				t.Errorf("storedSpansPerTrace must count distinct span ids")
			}
		})
	})

	t.Run("given event_log holds several command types per trace", func(t *testing.T) {
		t.Run("filters to a single event type so the count means spans", func(t *testing.T) {
			if !strings.Contains(queries["eventLogCounts"], "EventType = {eventType:String}") {
				t.Errorf("eventLogCounts must filter to one event type")
			}
		})
	})

	t.Run("given leakage is data you did not put there", func(t *testing.T) {
		t.Run("asks for traces NOT in the sent set", func(t *testing.T) {
			if !strings.Contains(queries["foreignTraces"], "TraceId NOT IN {ownTraceIds:Array(String)}") {
				t.Errorf("foreignTraces must ask for traces not in the sent set")
			}
		})
	})
}

// @scenario "Spans of one trace arriving at once are still counted exactly once"
func TestFindCountMismatches(t *testing.T) {
	cases := []struct {
		describe  string
		it        string
		row       SummaryRow
		wantCount int
		wantKind  ViolationKind
		wantIn    string
	}{
		{
			describe:  "when the summary agrees with stored spans",
			it:        "reports no violation",
			row:       SummaryRow{TraceId: "a", SpanCount: 50, StoredSpans: 50},
			wantCount: 0,
		},
		{
			describe:  "when the summary counts more than exist",
			it:        "reports double counting, the bug this benchmark exists for",
			row:       SummaryRow{TraceId: "a", SpanCount: 60, StoredSpans: 50},
			wantCount: 1,
			wantKind:  ViolationDoubleCounted,
			wantIn:    "10 span(s) more than once",
		},
		{
			describe:  "when the summary counts fewer than exist",
			it:        "reports under counting as a distinct failure",
			row:       SummaryRow{TraceId: "a", SpanCount: 40, StoredSpans: 50},
			wantCount: 1,
			wantKind:  ViolationUnderCounted,
			wantIn:    "10 span(s) never reached the fold",
		},
	}

	for _, c := range cases {
		t.Run(c.describe, func(t *testing.T) {
			t.Run(c.it, func(t *testing.T) {
				got := FindCountMismatches(FindCountMismatchesOptions{
					TenantId: "t1",
					Rows:     []SummaryRow{c.row},
				})
				if len(got) != c.wantCount {
					t.Fatalf("got %d violations, want %d", len(got), c.wantCount)
				}
				if c.wantCount == 0 {
					return
				}
				if got[0].Kind != c.wantKind {
					t.Errorf("got kind %q, want %q", got[0].Kind, c.wantKind)
				}
				if !strings.Contains(got[0].Detail, c.wantIn) {
					t.Errorf("detail %q does not contain %q", got[0].Detail, c.wantIn)
				}
			})
		})
	}

	t.Run("given ClickHouse returns counts as strings", func(t *testing.T) {
		t.Run("compares them numerically rather than lexically", func(t *testing.T) {
			// "9" > "50" as strings; a lexical compare would invent a violation.
			var row SummaryRow
			if err := json.Unmarshal([]byte(`{"TraceId":"a","SpanCount":"9","StoredSpans":"9"}`), &row); err != nil {
				t.Fatalf("decoding string counts failed: %v", err)
			}
			got := FindCountMismatches(FindCountMismatchesOptions{TenantId: "t1", Rows: []SummaryRow{row}})
			if len(got) != 0 {
				t.Errorf("got %d violations, want 0", len(got))
			}
		})

		t.Run("still detects a real mismatch across string values", func(t *testing.T) {
			var row SummaryRow
			if err := json.Unmarshal([]byte(`{"TraceId":"a","SpanCount":"100","StoredSpans":"20"}`), &row); err != nil {
				t.Fatalf("decoding string counts failed: %v", err)
			}
			got := FindCountMismatches(FindCountMismatchesOptions{TenantId: "t1", Rows: []SummaryRow{row}})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if got[0].Kind != ViolationDoubleCounted {
				t.Errorf("got kind %q, want %q", got[0].Kind, ViolationDoubleCounted)
			}
		})

		t.Run("decodes a plain JSON number too", func(t *testing.T) {
			var row StoredSpanCount
			if err := json.Unmarshal([]byte(`{"TraceId":"a","SpanCount":42}`), &row); err != nil {
				t.Fatalf("decoding numeric count failed: %v", err)
			}
			if row.SpanCount != 42 {
				t.Errorf("got %d, want 42", row.SpanCount)
			}
		})
	})
}

func TestFindMissingSummaries(t *testing.T) {
	t.Run("when a sent trace produced no summary", func(t *testing.T) {
		t.Run("reports it", func(t *testing.T) {
			got := FindMissingSummaries(FindMissingSummariesOptions{
				TenantId:           "t1",
				ExpectedTraceIds:   []string{"a", "b"},
				SummarizedTraceIds: traceIdSet("a"),
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if got[0].TraceId != "b" {
				t.Errorf("got trace %q, want %q", got[0].TraceId, "b")
			}
			if got[0].Kind != ViolationMissingSummary {
				t.Errorf("got kind %q, want %q", got[0].Kind, ViolationMissingSummary)
			}
		})
	})

	t.Run("when every trace has a summary", func(t *testing.T) {
		t.Run("reports nothing", func(t *testing.T) {
			got := FindMissingSummaries(FindMissingSummariesOptions{
				TenantId:           "t1",
				ExpectedTraceIds:   []string{"a"},
				SummarizedTraceIds: traceIdSet("a"),
			})
			if len(got) != 0 {
				t.Errorf("got %d violations, want 0", len(got))
			}
		})
	})
}

// @scenario "Interleaved tenants never see each other's spans"
func TestFindCrossTenantLeaks(t *testing.T) {
	t.Run("when a foreign trace appears under a tenant", func(t *testing.T) {
		t.Run("reports leakage naming both the trace and the tenant", func(t *testing.T) {
			got := FindCrossTenantLeaks(FindCrossTenantLeaksOptions{
				TenantId:        "tenant-b",
				ForeignTraceIds: []string{"trace-from-a"},
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if got[0].Kind != ViolationCrossTenantLeak {
				t.Errorf("got kind %q, want %q", got[0].Kind, ViolationCrossTenantLeak)
			}
			for _, want := range []string{"trace-from-a", "tenant-b"} {
				if !strings.Contains(got[0].Detail, want) {
					t.Errorf("detail %q does not name %q", got[0].Detail, want)
				}
			}
		})
	})

	t.Run("when no foreign traces are present", func(t *testing.T) {
		t.Run("reports nothing", func(t *testing.T) {
			got := FindCrossTenantLeaks(FindCrossTenantLeaksOptions{TenantId: "t"})
			if len(got) != 0 {
				t.Errorf("got %d violations, want 0", len(got))
			}
		})
	})
}

// @scenario "Bursty arrival does not lose or duplicate spans"
func TestFindLayerDivergence(t *testing.T) {
	t.Run("when spans never reached the event log", func(t *testing.T) {
		t.Run("blames the ingest layer", func(t *testing.T) {
			got := FindLayerDivergence(FindLayerDivergenceOptions{
				TenantId:    "t1",
				Accepted:    map[string]int{"a": 100},
				EventLog:    map[string]int{"a": 80},
				StoredSpans: map[string]int{"a": 80},
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if !strings.Contains(got[0].Detail, "INGEST layer") {
				t.Errorf("detail %q does not blame the ingest layer", got[0].Detail)
			}
		})
	})

	t.Run("when events exist but spans were not stored", func(t *testing.T) {
		t.Run("blames the projection layer", func(t *testing.T) {
			got := FindLayerDivergence(FindLayerDivergenceOptions{
				TenantId:    "t1",
				Accepted:    map[string]int{"a": 100},
				EventLog:    map[string]int{"a": 100},
				StoredSpans: map[string]int{"a": 70},
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if !strings.Contains(got[0].Detail, "PROJECTION layer") {
				t.Errorf("detail %q does not blame the projection layer", got[0].Detail)
			}
		})
	})

	// Excess, not just shortfall. Only shortfalls were reported, so the
	// duplication this benchmark exists to catch could pass at either layer.

	t.Run("when the event log holds more than the receiver accepted", func(t *testing.T) {
		t.Run("reports double counting at the ingest layer", func(t *testing.T) {
			got := FindLayerDivergence(FindLayerDivergenceOptions{
				TenantId:    "t1",
				Accepted:    map[string]int{"a": 100},
				EventLog:    map[string]int{"a": 118},
				StoredSpans: map[string]int{"a": 118},
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if got[0].Kind != ViolationDoubleCounted {
				t.Errorf("got kind %q, want %q", got[0].Kind, ViolationDoubleCounted)
			}
			if !strings.Contains(got[0].Detail, "INGEST layer") {
				t.Errorf("detail %q does not blame the ingest layer", got[0].Detail)
			}
		})
	})

	t.Run("when more spans were stored than there were events", func(t *testing.T) {
		t.Run("reports double counting at the projection layer", func(t *testing.T) {
			got := FindLayerDivergence(FindLayerDivergenceOptions{
				TenantId:    "t1",
				Accepted:    map[string]int{"a": 100},
				EventLog:    map[string]int{"a": 100},
				StoredSpans: map[string]int{"a": 140},
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if got[0].Kind != ViolationDoubleCounted {
				t.Errorf("got kind %q, want %q", got[0].Kind, ViolationDoubleCounted)
			}
			if !strings.Contains(got[0].Detail, "PROJECTION layer") {
				t.Errorf("detail %q does not blame the projection layer", got[0].Detail)
			}
		})
	})

	t.Run("when a span is lost at the ingest layer", func(t *testing.T) {
		t.Run("reports one violation, not one per downstream layer", func(t *testing.T) {
			got := FindLayerDivergence(FindLayerDivergenceOptions{
				TenantId:    "t1",
				Accepted:    map[string]int{"a": 100},
				EventLog:    map[string]int{"a": 50},
				StoredSpans: map[string]int{"a": 50},
			})
			if len(got) != 1 {
				t.Errorf("got %d violations, want 1", len(got))
			}
		})
	})

	t.Run("when every layer agrees", func(t *testing.T) {
		t.Run("reports nothing", func(t *testing.T) {
			got := FindLayerDivergence(FindLayerDivergenceOptions{
				TenantId:    "t1",
				Accepted:    map[string]int{"a": 100},
				EventLog:    map[string]int{"a": 100},
				StoredSpans: map[string]int{"a": 100},
			})
			if len(got) != 0 {
				t.Errorf("got %d violations, want 0", len(got))
			}
		})
	})
}

func TestFindResendDrift(t *testing.T) {
	t.Run("when the dedup gate holds", func(t *testing.T) {
		t.Run("reports nothing", func(t *testing.T) {
			got := FindResendDrift(FindResendDriftOptions{
				TenantId: "t1",
				Before:   map[string]int{"a": 100},
				After:    map[string]int{"a": 100},
			})
			if len(got) != 0 {
				t.Errorf("got %d violations, want 0", len(got))
			}
		})
	})

	t.Run("when a resend inflated the counter", func(t *testing.T) {
		t.Run("reports double counting", func(t *testing.T) {
			got := FindResendDrift(FindResendDriftOptions{
				TenantId: "t1",
				Before:   map[string]int{"a": 100},
				After:    map[string]int{"a": 112},
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if got[0].Kind != ViolationDoubleCounted {
				t.Errorf("got kind %q, want %q", got[0].Kind, ViolationDoubleCounted)
			}
			if !strings.Contains(got[0].Detail, "dedup gate did not hold") {
				t.Errorf("detail %q does not name the dedup gate", got[0].Detail)
			}
		})
	})

	t.Run("when the counter fell after a resend", func(t *testing.T) {
		// This case used to assert nothing was reported, on the reasoning that a
		// fall is a different failure and belongs to a different check. Nothing
		// else catches it: the resend probe runs AFTER verifyStage, so a count
		// the resend destroyed is never looked at again, and the run would have
		// gone green on data the probe itself deleted.
		//
		// It is still not reported as drift. It is reported as loss.
		t.Run("reports it as loss rather than as drift", func(t *testing.T) {
			got := FindResendDrift(FindResendDriftOptions{
				TenantId: "t1",
				Before:   map[string]int{"a": 100},
				After:    map[string]int{"a": 90},
			})
			if len(got) != 1 {
				t.Fatalf("got %d violations, want 1", len(got))
			}
			if got[0].Kind != ViolationLostSpans {
				t.Errorf("got kind %q, want %q", got[0].Kind, ViolationLostSpans)
			}
			if !strings.Contains(got[0].Detail, "FELL") {
				t.Errorf("detail %q does not say the count fell", got[0].Detail)
			}
		})
	})
}

// @scenario "A benchmark that could not run is not reported as a passing run"
// @scenario "A correctness violation fails the run"
func TestIsFailure(t *testing.T) {
	t.Run("treats any violation as a hard failure", func(t *testing.T) {
		if !IsFailure([]Violation{{Kind: ViolationLostSpans, TenantId: "t", Detail: "d"}}) {
			t.Errorf("got false, want true")
		}
	})

	t.Run("passes a clean run", func(t *testing.T) {
		if IsFailure(nil) {
			t.Errorf("got true, want false")
		}
	})
}

// @scenario "A run that finds a violation is distinguishable from a broken run"
func TestSummarizeViolations(t *testing.T) {
	t.Run("given no violations", func(t *testing.T) {
		t.Run("says so plainly", func(t *testing.T) {
			if !strings.Contains(SummarizeViolations(nil), "No correctness violations") {
				t.Errorf("empty summary does not say so plainly")
			}
		})
	})

	t.Run("given many violations of one kind", func(t *testing.T) {
		t.Run("caps the detail dump so a systemic bug does not bury the summary", func(t *testing.T) {
			violations := make([]Violation, 0, 50)
			for i := range 50 {
				violations = append(violations, Violation{
					Kind:     ViolationLostSpans,
					TenantId: "t",
					TraceId:  fmt.Sprintf("trace-%d", i),
					Detail:   "lost",
				})
			}
			summary := SummarizeViolations(violations)
			for _, want := range []string{"50 occurrence(s)", "and 40 more"} {
				if !strings.Contains(summary, want) {
					t.Errorf("summary does not contain %q", want)
				}
			}
			if got := strings.Count(summary, "  - tenant"); got != 10 {
				t.Errorf("got %d detail lines, want 10", got)
			}
		})
	})

	t.Run("given violations of several kinds", func(t *testing.T) {
		t.Run("groups them by kind", func(t *testing.T) {
			summary := SummarizeViolations([]Violation{
				{Kind: ViolationLostSpans, TenantId: "t", Detail: "a"},
				{Kind: ViolationCrossTenantLeak, TenantId: "t", Detail: "b"},
			})
			for _, want := range []string{"**lost-spans**", "**cross-tenant-leak**"} {
				if !strings.Contains(summary, want) {
					t.Errorf("summary does not contain %q", want)
				}
			}
		})
	})
}
