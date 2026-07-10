// Package egress is a thin seam for per-worker egress monitoring. It exists so
// that PR3 (egress monitoring) can slot real behaviour behind the Guard
// interface without restructuring the worker pool. This PR ships ONLY the
// interface and a pass-through implementation — no monitoring logic lands here.
//
// The pool consults the Guard around a worker's lifecycle: PrepareWorker runs
// before the opencode subprocess starts (so an implementation could set up
// per-worker egress policy / observation, and can fail the spawn closed), and
// ReleaseWorker runs when the worker is torn down (so an implementation can
// clean up whatever it set up).
package egress

import "context"

// WorkerContext is the minimal per-worker identity the guard needs. Kept small
// on purpose — PR3 widens it if it needs more, without touching the pool.
type WorkerContext struct {
	// ConversationID is the per-conversation worker key.
	ConversationID string
	// UID is the kernel UID the worker subprocess runs as.
	UID uint32
}

// Guard is the per-worker egress seam. A returned error from PrepareWorker
// fails the spawn closed (the worker does not start) — matching the platform's
// fail-closed posture for anything security-adjacent.
type Guard interface {
	PrepareWorker(ctx context.Context, w WorkerContext) error
	ReleaseWorker(ctx context.Context, conversationID string)
}

// PassThrough is the default Guard: it does nothing and changes no behaviour.
// PR3 replaces it with a real implementation.
type PassThrough struct{}

// NewPassThrough returns the no-op guard.
func NewPassThrough() PassThrough { return PassThrough{} }

// PrepareWorker is a no-op; the worker starts unmonitored, exactly as before.
func (PassThrough) PrepareWorker(_ context.Context, _ WorkerContext) error { return nil }

// ReleaseWorker is a no-op.
func (PassThrough) ReleaseWorker(_ context.Context, _ string) {}

// Ensure PassThrough satisfies Guard at compile time.
var _ Guard = PassThrough{}
