package ingestionbench

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

// settleWatchFor is one tenant waiting on one trace for a given number of
// spans, which is the smallest thing the settle loop can be asked to do.
func settleWatchFor(expected int, timeout time.Duration) settleWatch {
	tenant := Tenant{ProjectID: "p1", APIKey: "sk-lw-a"}
	return settleWatch{
		Tenants:          []Tenant{tenant},
		TracesByTenant:   map[string][]string{tenant.ProjectID: {"trace-1"}},
		ExpectedByTenant: map[string]int{tenant.ProjectID: expected},
		Window:           TimeWindow{FromMs: 1, ToMs: 2},
		Timeout:          timeout,
		Log:              io.Discard,
	}
}

// @scenario "A pipeline that never caught up is inconclusive, not lost data"
func TestWaitForSettle(t *testing.T) {
	t.Run("given the stored count reaches what was accepted", func(t *testing.T) {
		t.Run("reports that the pipeline settled", func(t *testing.T) {
			client := clickhouseStub(t, `{"TraceId":"trace-1","SpanCount":"5","EventCount":"5"}`)

			if !waitForSettle(context.Background(), client, settleWatchFor(5, 30*time.Second)) {
				t.Error("got false, want true: the stored count had reached the accepted count")
			}
		})
	})

	t.Run("given the stored count never reaches what was accepted", func(t *testing.T) {
		t.Run("reports that it gave up waiting", func(t *testing.T) {
			// This is the signal that decides exit 2 rather than exit 1. Before
			// it was returned, a still-draining pipeline was verified anyway
			// and its shortfalls were reported as lost data.
			client := clickhouseStub(t, `{"TraceId":"trace-1","SpanCount":"3","EventCount":"3"}`)

			if waitForSettle(context.Background(), client, settleWatchFor(5, 300*time.Millisecond)) {
				t.Error("got true, want false: the stored count was short of the accepted count")
			}
		})

		t.Run("says the shortfalls are inconclusive rather than lost", func(t *testing.T) {
			client := clickhouseStub(t, `{"TraceId":"trace-1","SpanCount":"3","EventCount":"3"}`)
			watch := settleWatchFor(5, 300*time.Millisecond)
			log := &strings.Builder{}
			watch.Log = log

			waitForSettle(context.Background(), client, watch)

			if !strings.Contains(log.String(), "INCONCLUSIVE") {
				t.Errorf("timeout log does not name the verdict it produces: %q", log.String())
			}
		})
	})

	t.Run("given the run was canceled", func(t *testing.T) {
		t.Run("gives up immediately rather than polling a dead context", func(t *testing.T) {
			client := clickhouseStub(t, `{"TraceId":"trace-1","SpanCount":"0","EventCount":"0"}`)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()

			started := time.Now()
			if waitForSettle(ctx, client, settleWatchFor(5, time.Minute)) {
				t.Error("got true, want false: a canceled run has not settled")
			}
			if elapsed := time.Since(started); elapsed > 5*time.Second {
				t.Errorf("spun for %s on a canceled context", elapsed)
			}
		})
	})
}
