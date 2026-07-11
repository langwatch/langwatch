package egress

import (
	"context"
	"testing"
)

func TestPassThrough_PrepareWorkerIsNoOp(t *testing.T) {
	g := NewPassThrough()
	if err := g.PrepareWorker(context.Background(), WorkerContext{ConversationID: "c", UID: 2000}); err != nil {
		t.Fatalf("pass-through PrepareWorker must never error, got %v", err)
	}
	// ReleaseWorker must not panic.
	g.ReleaseWorker(context.Background(), "c")
}

func TestPassThrough_SatisfiesGuard(t *testing.T) {
	var _ Guard = NewPassThrough()
}
