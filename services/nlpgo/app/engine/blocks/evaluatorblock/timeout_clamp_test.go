package evaluatorblock_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
)

// silentServer answers nothing until the client gives up, so the only thing
// that can end a call against it is the executor's own deadline.
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

// TestEvaluator_RequestTimeoutCannotExceedTheOperatorCeiling pins that a
// node's `TimeoutMS` only ever shortens the budget. Options.DefaultTimeout
// carries NLPGO_ENGINE_EVALUATOR_TIMEOUT_SECONDS — the bound on how long one
// evaluator call may hold a worker — so a larger number arriving from a
// workflow node must not win.
// @scenario "An evaluator timeout_ms cannot exceed the operator's ceiling"
func TestEvaluator_RequestTimeoutCannotExceedTheOperatorCeiling(t *testing.T) {
	base := silentServer(t)
	exec := evaluatorblock.New(evaluatorblock.Options{
		DefaultTimeout: 200 * time.Millisecond,
	})

	start := time.Now()
	_, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       base,
		APIKey:        "test-key",
		EvaluatorSlug: "langevals/exact_match",
		Data:          map[string]any{"input": "hi"},
		TimeoutMS:     30000,
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("want an error, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("want a deadline-exceeded error, got %v", err)
	}
	if elapsed >= 3*time.Second {
		t.Errorf("elapsed = %v; the ceiling, not the request, must decide", elapsed)
	}
}
