package app

import (
	"context"
	"time"
)

// CodingAgent is the driven port for a coding agent the worker runs a turn on;
// adapters/pi is the implementation. The sandbox stands the agent's process up
// and the app then drives the turn through this port, so nothing above it
// depends on the agent's wire protocol.
//
// TRUST BOUNDARY: the agent's output (its events, tokens, tool calls) flows back
// through the manager, which reads Stream and is the SOLE author + signer of the
// frames that reach the control plane. The agent never holds the runToken and
// never talks to the relay directly — "the agent goes through us".
//
// Process provisioning + spawn are the runner's concern (the app.Runner seam) and fold
// into this port at the runner seam; today it covers readiness, session, and the
// per-turn drive — the stable half the worker uses after the sandbox is up.
type CodingAgent interface {
	// WaitReady blocks until the agent has completed its ready handshake, or
	// fails closed. Returns a herr on a readiness timeout.
	WaitReady(ctx context.Context) error
	// OpenSession returns the session the per-turn calls below are routed to.
	// The agent RESUMES the newest session it already holds on disk when one
	// exists (`resumed` true) — the worker home outlives the process on an idle
	// reap or a crash, and resuming keeps the conversation's own context and a
	// byte-stable prompt prefix instead of re-seeding a transcript into a fresh
	// session. With nothing to resume it starts fresh (`resumed` false).
	OpenSession(ctx context.Context) (sessionID string, resumed bool, err error)
	// Post queues a turn on sessionID. A herr(domain.ErrSessionNotFound) means the
	// session vanished and the worker must be recycled.
	Post(ctx context.Context, sessionID string, turn Turn) error
	// Stream tails the turn's events for sessionID and forwards them into sink
	// until a terminal event or ctx cancellation.
	Stream(ctx context.Context, sessionID string, sink ChatSink) error
	// NotifyShutdownImminent (ADR-048) asks the agent to checkpoint the in-flight
	// turn and emit a terminal handoff frame before its process group is killed.
	NotifyShutdownImminent(ctx context.Context, sessionID string, deadline time.Time) error
}

// Turn is one message queued on a coding-agent session. ResumeToken (ADR-048)
// carries an opaque prior-turn checkpoint to resume from; empty on a cold start.
//
// TurnID is the control plane's turn id (the one the worker Claimed). The
// adapter tags the wrapper's `turn` command with it, so a later `abort` naming
// the same id (TurnAborter) reaches exactly this turn on the wire. Empty for an
// older control plane that threads none, the adapter then mints a private id,
// and an abort (which requires a name) cannot arrive for it anyway.
type Turn struct {
	TurnID      string
	System      string
	Prompt      string
	ResumeToken string
}
