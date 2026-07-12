package workerpool

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// newHandoffWorker builds a Worker pointing at a test opencode control server,
// claimed (in-flight), for the ShutdownHandoff pool tests. Same-package access
// to the unexported fields keeps this out of the real spawn path.
func newHandoffWorker(conversationID, sessionID, baseURL string) *Worker {
	w := &Worker{
		conversationID:    conversationID,
		baseURL:           baseURL,
		bearerToken:       "b",
		openCodeSessionID: sessionID,
	}
	w.Claim() // mark in-flight
	return w
}

// ShutdownHandoff notifies every live worker and returns as soon as the
// in-flight turns quiesce (their StreamEvents saw the terminal handoff frame and
// Released), well before the deadline.
func TestPool_ShutdownHandoff_NotifiesAndWaitsForQuiesce(t *testing.T) {
	var mu sync.Mutex
	notified := map[string]bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/shutdown_imminent") {
			mu.Lock()
			notified[r.URL.Path] = true
			mu.Unlock()
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	p := newTestPool(4)
	w1 := newHandoffWorker("conv-1", "sess-1", srv.URL)
	w2 := newHandoffWorker("conv-2", "sess-2", srv.URL)
	p.workers["conv-1"] = w1
	p.workers["conv-2"] = w2

	// Simulate the in-flight turns finishing shortly after the notice.
	go func() {
		time.Sleep(120 * time.Millisecond)
		w1.Release()
		w2.Release()
	}()

	start := time.Now()
	p.ShutdownHandoff(context.Background(), time.Now().Add(3*time.Second))
	elapsed := time.Since(start)

	if elapsed >= 3*time.Second {
		t.Errorf("ShutdownHandoff waited for the full deadline (%s) instead of returning on quiesce", elapsed)
	}
	mu.Lock()
	defer mu.Unlock()
	if !notified["/session/sess-1/shutdown_imminent"] || !notified["/session/sess-2/shutdown_imminent"] {
		t.Errorf("expected every live worker to be notified, got %v", notified)
	}
}

// A turn that never quiesces caps at the deadline and falls back to cold restart
// (the honest ADR-048 limit) — it must not block past the deadline.
func TestPool_ShutdownHandoff_CapsAtDeadline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	p := newTestPool(4)
	// Claimed and never released — the turn does not quiesce.
	p.workers["conv-stuck"] = newHandoffWorker("conv-stuck", "sess-stuck", srv.URL)

	start := time.Now()
	p.ShutdownHandoff(context.Background(), time.Now().Add(250*time.Millisecond))
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Errorf("ShutdownHandoff blocked past the deadline: %s", elapsed)
	}
	if elapsed < 200*time.Millisecond {
		t.Errorf("ShutdownHandoff returned before the deadline: %s", elapsed)
	}
}

// No live workers ⇒ a no-op that returns immediately.
func TestPool_ShutdownHandoff_NoWorkersIsNoop(t *testing.T) {
	p := newTestPool(4)
	start := time.Now()
	p.ShutdownHandoff(context.Background(), time.Now().Add(5*time.Second))
	if time.Since(start) > 500*time.Millisecond {
		t.Errorf("ShutdownHandoff with no workers should return immediately")
	}
}
