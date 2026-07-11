package egress

import (
	"context"
	"testing"
)

func TestPassThrough_PrepareWorkerIsNoOp(t *testing.T) {
	g := NewPassThrough()
	we, err := g.PrepareWorker(context.Background(), WorkerContext{ConversationID: "c", UID: 2000})
	if err != nil {
		t.Fatalf("pass-through PrepareWorker must never error, got %v", err)
	}
	if we.ProxyPort != 0 {
		t.Fatalf("pass-through must run no proxy, got ProxyPort=%d", we.ProxyPort)
	}
	// Close + ReleaseWorker must not panic.
	we.Close()
	g.ReleaseWorker(context.Background(), "c")
}

func TestPassThrough_SatisfiesGuard(t *testing.T) {
	var _ Guard = NewPassThrough()
}
