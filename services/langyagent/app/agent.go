package app

import (
	"context"
	"time"
)

// CodingAgent is the driven port for a coding agent the worker runs a turn on —
// opencode is the implementation (adapters/opencode). The sandbox stands the
// agent's process up and hands back an Endpoint; the app then drives the turn
// through this port, so nothing above it depends on the agent's wire protocol.
//
// TRUST BOUNDARY: the agent's output (its events, tokens, tool calls) flows back
// through the manager, which reads Stream and is the SOLE author + signer of the
// frames that reach the control plane. The agent never holds the runToken and
// never talks to the relay directly — "the agent goes through us".
//
// Process provisioning + spawn are the runner's concern (app/runner) and fold
// into this port at the runner seam; today it covers readiness, session, and the
// per-turn drive — the stable half the worker uses after the sandbox is up.
type CodingAgent interface {
	// WaitReady blocks until the agent at ep is listening AND enforcing auth on
	// its control port, or fails closed. Returns a herr on a definite security
	// failure or a readiness timeout.
	WaitReady(ctx context.Context, ep Endpoint) error
	// OpenSession starts a fresh session on the agent and returns its id; the
	// per-turn calls below are routed to it.
	OpenSession(ctx context.Context, ep Endpoint) (sessionID string, err error)
	// Post queues a turn on sessionID. A herr(domain.ErrSessionNotFound) means the
	// session vanished and the worker must be recycled.
	Post(ctx context.Context, ep Endpoint, sessionID string, turn Turn) error
	// Stream tails the turn's events for sessionID and forwards them into sink
	// until a terminal event or ctx cancellation.
	Stream(ctx context.Context, ep Endpoint, sessionID string, sink ChatSink) error
	// NotifyShutdownImminent (ADR-048) asks the agent to checkpoint the in-flight
	// turn and emit a terminal handoff frame before its process group is killed.
	NotifyShutdownImminent(ctx context.Context, ep Endpoint, sessionID string, deadline time.Time) error
}

// Endpoint is the loopback address + credential the sandbox exposes for a
// running coding-agent process. The sandbox owns the ports and the authproxy
// bearer; the agent is driven through it.
type Endpoint struct {
	// BaseURL is the external, authproxy-fronted address the agent is driven
	// through ("http://127.0.0.1:<externalPort>"), precomputed so per-turn calls
	// don't re-Sprintf the host.
	BaseURL string
	// ExternalPort is the authproxy listener; InternalPort is the agent's own
	// control port, which WaitReady checks directly for enforced auth.
	ExternalPort int
	InternalPort int
	// BearerToken authenticates to the authproxy on ExternalPort.
	BearerToken string
}

// Turn is one message queued on a coding-agent session. ResumeToken (ADR-048)
// carries an opaque prior-turn checkpoint to resume from; empty on a cold start.
type Turn struct {
	System      string
	Prompt      string
	ResumeToken string
}
