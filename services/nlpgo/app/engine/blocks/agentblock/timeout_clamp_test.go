package agentblock_test

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/agentblock"
)

// silentServer answers nothing until the client gives up, so the only thing
// that can end a call against it is the runner's own deadline.
func silentServer(t *testing.T) string {
	t.Helper()
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		close(release)
		srv.Close()
	})
	return srv.URL
}

// TestWorkflowRunner_RequestTimeoutCannotExceedTheOperatorCeiling pins that a
// node's `TimeoutMS` only ever shortens the budget. WorkflowRunnerOptions.
// DefaultTimeout carries NLPGO_ENGINE_AGENT_WORKFLOW_TIMEOUT_SECONDS — the
// bound on how long one sub-workflow call may hold a worker — so a larger
// number arriving from a workflow node must not win.
// @scenario "An agent sub-workflow timeout_ms cannot exceed the operator's ceiling"
func TestWorkflowRunner_RequestTimeoutCannotExceedTheOperatorCeiling(t *testing.T) {
	base := silentServer(t)
	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{
		DefaultTimeout: 200 * time.Millisecond,
	})

	start := time.Now()
	_, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    base,
		APIKey:     "test-key",
		WorkflowID: "wf_1",
		Inputs:     map[string]any{"q": "hi"},
		TimeoutMS:  30000,
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("want an error, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("want a deadline-exceeded error, got %v", err)
	}
	if elapsed < 150*time.Millisecond {
		t.Errorf("elapsed = %v; the 200ms ceiling must be what fired, not an immediate cancellation", elapsed)
	}
	if elapsed >= 3*time.Second {
		t.Errorf("elapsed = %v; the ceiling, not the request, must decide", elapsed)
	}
}

// TestWorkflowRunner_OverflowingRequestTimeoutClampsToTheCeiling pins the edge
// that turns "can only shorten" into "fails instantly": a TimeoutMS large
// enough that milliseconds-to-nanoseconds overflows int64 lands on a NEGATIVE
// duration, which reads as smaller than the ceiling and expires the context
// before the call is sent. Such a value must fall back to the ceiling.
// @scenario "An agent sub-workflow's overflowing timeout_ms falls back to the operator's ceiling"
func TestWorkflowRunner_OverflowingRequestTimeoutClampsToTheCeiling(t *testing.T) {
	base := silentServer(t)
	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{
		DefaultTimeout: 200 * time.Millisecond,
	})

	start := time.Now()
	_, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    base,
		APIKey:     "test-key",
		WorkflowID: "wf_1",
		Inputs:     map[string]any{"q": "hi"},
		TimeoutMS:  math.MaxInt64,
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("want an error, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("want a deadline-exceeded error, got %v", err)
	}
	if elapsed < 150*time.Millisecond {
		t.Errorf("elapsed = %v; an overflowed budget must not expire the call immediately", elapsed)
	}
	if elapsed >= 3*time.Second {
		t.Errorf("elapsed = %v; the ceiling, not the request, must decide", elapsed)
	}
}
