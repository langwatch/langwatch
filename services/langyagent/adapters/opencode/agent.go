package opencode

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// Agent implements app.CodingAgent over opencode's loopback HTTP API — the
// object seam over this package's client functions. The sandbox constructs one
// per worker and drives readiness + session at spawn; the worker drives the
// per-turn Post/Stream/Notify. Stateless apart from the readiness timeout.
type Agent struct {
	readinessTimeout time.Duration
}

// compile-time proof Agent satisfies the app port.
var _ app.CodingAgent = (*Agent)(nil)

// NewAgent returns an opencode CodingAgent. readinessTimeout bounds WaitReady's
// startup poll (the same value the pool used to pass to WaitForReadiness).
func NewAgent(readinessTimeout time.Duration) *Agent {
	return &Agent{readinessTimeout: readinessTimeout}
}

// WaitReady blocks until opencode is listening AND enforcing control-port auth,
// or fails closed — see WaitForReadiness for the two-probe contract.
func (a *Agent) WaitReady(ctx context.Context, ep app.Endpoint) error {
	return WaitForReadiness(ctx, ep.ExternalPort, ep.InternalPort, ep.BearerToken, a.readinessTimeout)
}

// OpenSession creates a fresh opencode session and returns its id.
func (a *Agent) OpenSession(ctx context.Context, ep app.Endpoint) (string, error) {
	return CreateSession(ctx, ep.ExternalPort, ep.BearerToken)
}

// Post queues a turn on the session.
func (a *Agent) Post(ctx context.Context, ep app.Endpoint, sessionID string, turn app.Turn) error {
	return PostMessage(ctx, ep.BaseURL, ep.BearerToken, sessionID, turn.System, turn.Prompt, turn.ResumeToken)
}

// Stream forwards the session's events into sink until a terminal event or ctx
// cancellation. sink is an io.Writer (raw ndjson) plus Flush.
func (a *Agent) Stream(ctx context.Context, ep app.Endpoint, sessionID string, sink app.ChatSink) error {
	return StreamSession(ctx, ep.BaseURL, ep.BearerToken, sessionID, sink, sink.Flush)
}

// NotifyShutdownImminent (ADR-048) posts the session-scoped shutdown notice.
func (a *Agent) NotifyShutdownImminent(ctx context.Context, ep app.Endpoint, sessionID string, deadline time.Time) error {
	return NotifyShutdownImminent(ctx, ep.BaseURL, ep.BearerToken, sessionID, deadline)
}
