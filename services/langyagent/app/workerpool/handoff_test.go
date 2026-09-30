package workerpool

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// notifyRecordingAgent records every shutdown-imminent notice, so the pool's
// pre-drain step can be exercised without a worker process.
type notifyRecordingAgent struct {
	mu       sync.Mutex
	notified []string
}

func (a *notifyRecordingAgent) WaitReady(context.Context) error { return nil }
func (a *notifyRecordingAgent) OpenSession(context.Context) (string, bool, error) {
	return "sess", false, nil
}
func (a *notifyRecordingAgent) Post(context.Context, string, app.Turn) error { return nil }
func (a *notifyRecordingAgent) Stream(context.Context, string, app.ChatSink) error {
	return nil
}

func (a *notifyRecordingAgent) NotifyShutdownImminent(_ context.Context, sessionID string, _ time.Time) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.notified = append(a.notified, sessionID)
	return nil
}

func (a *notifyRecordingAgent) sessions() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.notified...)
}

// newHandoffWorker builds a claimed (in-flight) Worker driving `agent`, for the
// ShutdownHandoff pool tests. Same-package access to the unexported fields
// keeps this out of the real spawn path.
func newHandoffWorker(conversationID, sessionID string, agent app.CodingAgent) *Worker {
	w := &Worker{
		conversationID: conversationID,
		agent:          agent,
		sessionID:      sessionID,
	}
	w.ClaimTurn("") // mark in-flight
	return w
}

// ShutdownHandoff notifies every live worker and returns as soon as the
// in-flight turns quiesce (their StreamEvents saw the terminal handoff frame and
// Released), well before the deadline.
func TestPool_ShutdownHandoff_NotifiesAndWaitsForQuiesce(t *testing.T) {
	agent := &notifyRecordingAgent{}

	p := newTestPool(4)
	w1 := newHandoffWorker("conv-1", "sess-1", agent)
	w2 := newHandoffWorker("conv-2", "sess-2", agent)
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
	notified := map[string]bool{}
	for _, s := range agent.sessions() {
		notified[s] = true
	}
	if !notified["sess-1"] || !notified["sess-2"] {
		t.Errorf("expected every live worker to be notified, got %v", notified)
	}
}

// A turn that never quiesces caps at the deadline and falls back to cold restart
// (the honest ADR-048 limit) — it must not block past the deadline.
func TestPool_ShutdownHandoff_CapsAtDeadline(t *testing.T) {
	p := newTestPool(4)
	// Claimed and never released — the turn does not quiesce.
	p.workers["conv-stuck"] = newHandoffWorker("conv-stuck", "sess-stuck", &notifyRecordingAgent{})

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
