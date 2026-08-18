package ingestionbench

// Waiting for the pipeline to catch up, and the ClickHouse reads that decide
// whether it has.

import (
	"context"
	"fmt"
	"io"
	"time"
)

// countRow is the shape every per-trace count query returns.
//
// The counts are clickhouseCount rather than json.Number because that type
// FAILS on a value it cannot read, and these numbers feed the violation rules
// directly. The previous accessor swallowed a decode error and returned 0,
// which FindLayerDivergence then reported as "the map projection dropped N"
// for data that was sitting in the table the whole time — a benchmark blaming
// the pipeline for its own parsing. An unreadable count now stops the query
// instead, which says "could not run" rather than "you lost data".
type countRow struct {
	TraceID    string          `json:"TraceId"`
	SpanCount  clickhouseCount `json:"SpanCount"`
	EventCount clickhouseCount `json:"EventCount"`
}

func (r countRow) spans() int { return int(r.SpanCount) }

func (r countRow) events() int { return int(r.EventCount) }

// waitForSettle polls until the pipeline has caught up, and reports whether it
// did before the timeout expired.
//
// Polls rather than sleeping a flat interval: a fixed sleep is either wasteful
// or (much worse) too short under load, which turns a slow pipeline into a
// false "lost spans" failure.
//
// The returned bool is the only place the difference between "caught up" and
// "gave up waiting" exists. Verification runs either way — the counts are worth
// having, and most of the checks are unaffected by lag — but a caller that
// threw this away would report a still-draining pipeline as lost data. It is
// what makes the run INCONCLUSIVE rather than FAILED; see ClassifyRun.
func waitForSettle(ctx context.Context, client *chClient, watch settleWatch) bool {
	deadline := time.Now().Add(watch.Timeout)
	interval := 250 * time.Millisecond

	for time.Now().Before(deadline) {
		// A canceled run has not settled, and polling a dead context only
		// spins until the deadline: every query fails instantly and every
		// sleep returns instantly.
		if ctx.Err() != nil {
			return false
		}

		if storedCaughtUp(ctx, client, watch) {
			// One extra beat so any in-flight fold write lands before we read
			// the summaries; reading a half-written projection looks like a bug.
			sleep(ctx, time.Second)
			return true
		}

		sleep(ctx, interval)
		interval = min(time.Duration(float64(interval)*1.5), 3*time.Second)
	}

	fmt.Fprintf(watch.Log,
		"[benchmark] settle timeout after %s — verifying anyway. Shortfalls below are reported "+
			"as INCONCLUSIVE rather than as loss; check the stage duration.\n", watch.Timeout)
	return false
}

// settleWatch is what one settle loop is waiting on.
type settleWatch struct {
	Tenants        []Tenant
	TracesByTenant map[string][]string
	// ExpectedByTenant is what the send phase saw ACCEPTED, never what it sent.
	ExpectedByTenant map[string]int
	Window           TimeWindow
	Timeout          time.Duration
	Log              io.Writer
}

// storedCaughtUp reports whether every tenant's stored spans have reached what
// the receiver accepted.
//
// A query failure counts as "not yet" rather than as an answer: a replica
// restarting or a merge stalling mid-settle is not a benchmark result. If
// ClickHouse is genuinely gone, the verification queries after the loop fail
// loudly rather than silently reporting every span lost.
func storedCaughtUp(ctx context.Context, client *chClient, watch settleWatch) bool {
	for _, tenant := range watch.Tenants {
		traceIDs := watch.TracesByTenant[tenant.ProjectID]
		if len(traceIDs) == 0 {
			continue
		}

		stored, err := storedSpanCount(ctx, client, traceWindowRead{
			Tenant:   tenant,
			TraceIDs: traceIDs,
			Window:   watch.Window,
		})
		if err != nil {
			fmt.Fprintf(watch.Log, "[benchmark] settle poll failed, retrying: %v\n", err)
			return false
		}
		if stored < watch.ExpectedByTenant[tenant.ProjectID] {
			return false
		}
	}
	return true
}

// storedSpanCount totals the spans stored for one tenant's traces in a window.
func storedSpanCount(ctx context.Context, client *chClient, read traceWindowRead) (int, error) {
	var rows []countRow
	err := queryJSON(ctx, client, chQuery{
		SQL: StoredSpansPerTraceQuery(),
		Params: map[string]any{
			"tenantId": read.Tenant.ProjectID,
			"traceIds": read.TraceIDs,
			"fromMs":   read.Window.FromMs,
			"toMs":     read.Window.ToMs,
		},
		Into: &rows,
	})
	if err != nil {
		return 0, err
	}

	stored := 0
	for _, row := range rows {
		stored += row.spans()
	}
	return stored, nil
}

// sleep waits, but gives up early if the run is canceled.
func sleep(ctx context.Context, duration time.Duration) {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
	}
}

// traceWindowRead names one tenant's traces over one window.
type traceWindowRead struct {
	Tenant   Tenant
	TraceIDs []string
	Window   TimeWindow
}

// readSummaryCounts reads current summary SpanCounts, for the resend
// before/after comparison.
func readSummaryCounts(ctx context.Context, client *chClient, read traceWindowRead) (map[string]int, error) {
	var rows []SummaryRow
	err := queryJSON(ctx, client, chQuery{
		SQL: SummaryVsStoredQuery(),
		Params: map[string]any{
			"tenantId": read.Tenant.ProjectID,
			"traceIds": read.TraceIDs,
			"fromMs":   read.Window.FromMs,
			"toMs":     read.Window.ToMs,
		},
		Into: &rows,
	})
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, row := range rows {
		counts[row.TraceId] = int(row.SpanCount)
	}
	return counts, nil
}
