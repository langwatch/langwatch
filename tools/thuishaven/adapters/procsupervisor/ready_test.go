package procsupervisor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// waitForReady must hold until the probe returns a non-5xx, then return — this is
// what keeps the web lane down until the API answers /api/health.
func TestWaitForReadyBlocksUntilTheProbeSucceeds(t *testing.T) {
	var ready atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if ready.Load() {
			w.WriteHeader(http.StatusNoContent) // 204, like /api/health
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable) // 503 → still 5xx → not ready
	}))
	defer srv.Close()

	done := make(chan struct{})
	go func() {
		waitForReady(context.Background(), srv.URL, func(string) {})
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("waitForReady returned before the probe was ready")
	case <-time.After(250 * time.Millisecond):
	}

	ready.Store(true)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("waitForReady did not return once the probe became ready")
	}
}

// A dependency that never comes up must not wedge the supervisor: ctx cancel
// (Ctrl-C) unblocks the wait.
func TestWaitForReadyReturnsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		waitForReady(ctx, "http://127.0.0.1:1/api/health", func(string) {})
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("waitForReady did not return on ctx cancel")
	}
}
