// Package egress is the per-worker egress seam and its implementations. The
// pool consults a Guard before a worker's opencode subprocess starts:
// PrepareWorker sets up this worker's egress policy and returns the loopback
// forward-proxy the worker's HTTPS_PROXY must point at, and may fail the spawn
// closed. Per-worker teardown rides the returned WorkerEgress.Close, not the
// guard.
//
// Two implementations live here:
//   - PassThrough: no-op, no proxy — the worker egresses direct, exactly as
//     before (used in tests / partial wiring).
//   - EnforcingGuard (enforcing.go): ADR-043 enforcement — a per-worker outbound
//     forward proxy (adapter.go) that require-TLS / throttles / applies the
//     floor ∪ allow-list policy / SNI-cross-checks every CONNECT, monitor-first.
package egress

import "context"

// WorkerContext is the per-worker identity + policy inputs the guard needs at
// spawn. Widened from PR3's {ConversationID, UID} to carry the project's egress
// allow-list (ADR-043 rung 2) threaded from the credentials envelope.
type WorkerContext struct {
	// ConversationID is the per-conversation worker key.
	ConversationID string
	// UID is the kernel UID the worker subprocess runs as.
	UID uint32
	// EgressAllowlist is the project's per-project Langy egress allow-list
	// (ADR-043 rung 2). The *presence* of the list is the enforcement mode:
	// nil/empty ⇒ the guard watches but blocks nothing; non-empty ⇒ the guard
	// restricts outbound to floor ∪ this list.
	EgressAllowlist []string
}

// WorkerEgress is the per-worker egress handle PrepareWorker returns. It carries
// the loopback forward-proxy port the worker's HTTPS_PROXY must point at (0 when
// the guard runs no proxy — pass-through / observe-only, so the worker egresses
// direct) and a Close that tears the proxy down. The pool stores it on the
// Worker and Closes it on every teardown path, exactly as it does the authProxy,
// so a per-worker proxy never outlives its worker (nor leaks across a recycle).
type WorkerEgress struct {
	// ProxyPort is the loopback port to inject as HTTPS_PROXY/HTTP_PROXY. Zero
	// means no per-worker proxy — the worker egresses direct as before.
	ProxyPort int
	// closeFn tears down the per-worker proxy. Nil for the no-proxy guards.
	closeFn func()
}

// Close tears down the per-worker egress adapter. Idempotent and nil-safe: the
// no-proxy guards return a zero WorkerEgress whose Close does nothing, and the
// enforcing guard wraps its shutdown in a sync.Once so kill + exit-watcher can
// both call it.
func (e WorkerEgress) Close() {
	if e.closeFn != nil {
		e.closeFn()
	}
}

// Guard is the per-worker egress seam. A returned error from PrepareWorker fails
// the spawn closed (the worker does not start) — matching the platform's
// fail-closed posture for anything security-adjacent.
type Guard interface {
	// PrepareWorker sets up per-worker egress before the subprocess starts and
	// returns the handle (proxy port + teardown) the pool threads into the
	// worker env and stores for teardown. An error fails the spawn closed.
	PrepareWorker(ctx context.Context, w WorkerContext) (WorkerEgress, error)
}

// PassThrough is the no-op Guard: it runs no proxy and changes no behaviour —
// the worker egresses direct, exactly as before. Used in tests and partial
// wiring.
type PassThrough struct{}

// NewPassThrough returns the no-op guard.
func NewPassThrough() PassThrough { return PassThrough{} }

// PrepareWorker is a no-op; the worker starts with no proxy (ProxyPort 0).
func (PassThrough) PrepareWorker(_ context.Context, _ WorkerContext) (WorkerEgress, error) {
	return WorkerEgress{}, nil
}

// Ensure PassThrough satisfies Guard at compile time.
var _ Guard = PassThrough{}
