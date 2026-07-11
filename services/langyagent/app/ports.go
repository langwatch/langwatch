// Package app is the langyagent application layer. It orchestrates a chat
// turn — acquire a worker, run the turn, map failures — through the consumer
// interfaces declared here, so it stays testable without a real worker pool or
// a real HTTP response. Driven adapters (adapters/workerpool) implement these
// ports; the driving adapter (adapters/httpapi) provides the ChatSink.
package app

import (
	"context"

	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// WorkerPool is the driven port the app uses to get a worker for a
// conversation. Implemented by adapters/workerpool.Pool.
type WorkerPool interface {
	// Acquire returns the worker for conversationID, spawning one if needed. A
	// herr(domain.ErrMaxWorkers) is returned at capacity.
	Acquire(ctx context.Context, conversationID string, creds domain.Credentials) (Worker, error)
	// Status returns the live worker count and the configured cap.
	Status() (active, max int)
	// KillSessionVanished recycles a worker whose opencode session disappeared.
	KillSessionVanished(conversationID string)
	// StartReaper begins the idle-worker sweep.
	StartReaper()
	// Shutdown tears down every worker.
	Shutdown()
}

// Worker is one acquired conversation worker. A turn Claims it, PostMessages the
// prompt, StreamEvents the reply, then Releases it.
type Worker interface {
	// Claim takes exclusive ownership of the worker for one turn. False means a
	// turn is already in flight (the orchestrator returns conversation-busy).
	Claim() bool
	// Release returns the worker to idle. Always paired with a successful Claim.
	Release()
	// Touch resets the idle timer.
	Touch()
	// PostMessage queues the turn on the worker's opencode session.
	PostMessage(ctx context.Context, system, prompt string) error
	// StreamEvents forwards this session's opencode events into sink until a
	// terminal event or ctx cancellation.
	StreamEvents(ctx context.Context, sink ChatSink) error
}

// ChatSink is the streaming transport the app writes a turn's ndjson events
// into. The httpapi adapter implements it over an http.ResponseWriter. It is an
// io.Writer (raw ndjson lines) plus turn-level helpers.
type ChatSink interface {
	// Begin commits the 200 status + ndjson response headers. Idempotent.
	Begin()
	// Write emits raw ndjson bytes (one line, newline included). Returns an
	// error on client disconnect so the stream stops promptly.
	Write(p []byte) (int, error)
	// ErrorEvent emits a {"type":"error","error":msg} ndjson line and flushes,
	// matching the wire shape the control-plane stream consumer expects.
	ErrorEvent(msg string)
	// Flush pushes buffered bytes to the client.
	Flush()
}
