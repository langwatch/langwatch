package app

import (
	"context"
	"time"
)

// CodingAgent is the driven port for a coding agent the worker runs a turn on —
// the pi adapter (adapters/pi) is the implementation. The runner stands the
// agent's process up; the app then drives the turn through this port, so
// nothing above it depends on the agent's wire protocol.
//
// TRUST BOUNDARY: the agent's output (its events, tokens, tool calls) flows back
// through the manager, which reads Stream and is the SOLE author + signer of the
// frames that reach the control plane. The agent never holds the runToken and
// never talks to the relay directly — "the agent goes through us".
//
// Process provisioning + spawn are the runner's concern (the app.Runner seam) and fold
// into this port at the runner seam; today it covers readiness, session, and the
// per-turn drive — the stable half the worker uses after the sandbox is up.
//
// This port carried an Endpoint on every method until ADR-131. That was the
// opencode harness's loopback address and authproxy bearer; the surviving
// harness is driven over the stdio pipes it was spawned with, which are held by
// the adapter itself and have no address to pass. AbortTurn and TurnEnded were
// separate optional capabilities for the same reason — opencode implemented
// neither, so the worker had to type-assert for them and no-op on a miss. With
// one harness that implements both, they are part of the port and a caller can
// simply call them.
type CodingAgent interface {
	// WaitReady blocks until the agent is ready to be driven, or fails closed.
	// Returns a herr on a definite failure or a readiness timeout.
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
	// AbortTurn stops the named in-flight turn mid-generation — the token-burn
	// half of the user's Stop (ADR-078). turnID names the one turn allowed to
	// die, so a late abort for a turn that already ended cannot reach the next
	// one.
	AbortTurn(ctx context.Context, sessionID, turnID string) error
	// TurnEnded clears per-turn state that must not survive into the next turn.
	// The worker calls it from Release, which runs after Post and Stream have
	// both finished, so the agent gets a point where no turn is in flight.
	//
	// It exists because Post and Stream are NOT ordered against each other:
	// app.go starts the Stream goroutine before PostMessage. An agent that hands
	// the turn from Post to Stream can be left holding a handle nobody consumed
	// (a turn abandoned between the two), and the NEXT turn's Stream could pick
	// that stale handle up instead of its own. Clearing at the boundary is what
	// makes the handoff unambiguous: turns are serialized by ClaimTurn, so
	// nothing left behind can reach the turn after it.
	TurnEnded()
}

// Turn is one message queued on a coding-agent session. ResumeToken (ADR-048)
// carries an opaque prior-turn checkpoint to resume from; empty on a cold start.
//
// TurnID is the control plane's turn id (the one the worker Claimed). The
// adapter tags the wrapper's `turn` command with it, so a later `abort` naming
// the same id reaches exactly this turn on the wire. Empty for an older control
// plane that threads none — the adapter then mints a private id, and an abort
// (which requires a name) cannot arrive for it anyway.
type Turn struct {
	TurnID      string
	System      string
	Prompt      string
	ResumeToken string
}
