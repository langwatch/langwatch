// Package app is the langyagent application layer. It orchestrates a chat
// turn — acquire a worker, run the turn, map failures — through the consumer
// interfaces declared here, so it stays testable without a real worker pool or
// a real HTTP response. Driven adapters (adapters/workerpool) implement these
// ports; the driving adapter (adapters/httpapi) provides the ChatSink.
package app

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// WorkerPool is the driven port the app uses to get a worker for a
// conversation. Implemented by adapters/workerpool.Pool.
type WorkerPool interface {
	// Acquire returns the worker for conversationID, spawning one if needed. A
	// herr(domain.ErrMaxWorkers) is returned at capacity. A herr with
	// domain.ErrCredentialsRequired is returned when a spawn is needed but the
	// credentials carry no session key — see HasLiveWorker.
	Acquire(ctx context.Context, conversationID string, creds domain.Credentials) (Worker, error)
	// HasLiveWorker reports whether a worker matching `sig` is already running for
	// this conversation. The control plane calls this BEFORE a turn to decide
	// whether it needs to mint a session key at all: a reused worker already
	// carries one in its environment, so minting a second would create a live
	// credential that nothing ever reads.
	//
	// Advisory only — the worker may die immediately after we answer. Acquire is
	// the authority, and it refuses a keyless spawn rather than booting a worker
	// that cannot reach LangWatch.
	HasLiveWorker(conversationID string, sig domain.CredentialSignature) bool
	// Status returns the live worker count and the configured cap.
	Status() (active, max int)
	// KillSessionVanished recycles a worker whose opencode session disappeared.
	KillSessionVanished(conversationID string)
	// StartReaper begins the idle-worker sweep.
	StartReaper()
	// ShutdownHandoff (ADR-048) is the pre-drain SIGTERM step: it notifies each
	// live worker that shutdown is imminent (so opencode checkpoints the
	// in-flight turn and emits a terminal handoff frame) and waits, bounded by
	// deadline, for those turns to quiesce. Runs BEFORE Shutdown so the handoff
	// frames reach the control plane before the process-group kill.
	ShutdownHandoff(ctx context.Context, deadline time.Time)
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
	// PostMessage queues the turn on the worker's opencode session. resumeToken
	// (ADR-048) carries an opaque prior-turn checkpoint to resume from; empty on
	// a cold start.
	PostMessage(ctx context.Context, system, prompt, resumeToken string) error
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
