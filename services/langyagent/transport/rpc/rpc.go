package rpc

import (
	"context"
	"strings"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// RPC is the typed request/response surface of the transport. Each verb is a
// plain method — Handle*(ctx, *Req) (*Resp, error) — that receives an ALREADY
// decoded + validated body and returns a value or a herr, never touching the
// http.ResponseWriter. The generic adapters that do the plumbing (decode+validate,
// call, serialize) live in the shared pkg/rpc — the router wires each verb through
// rpc.Handle / rpc.HandleNoContent. Streaming verbs (the worker turn) do NOT fit
// this shape and stay bespoke handlers.
type RPC struct {
	app          *app.App
	maxBodyBytes int64
}

// NewRPC builds the typed RPC surface over the app.
func NewRPC(application *app.App, maxBodyBytes int64) *RPC {
	return &RPC{app: application, maxBodyBytes: maxBodyBytes}
}

// HandleWarm boots the conversation's worker ahead of the turn. The control plane
// calls it the instant it knows a turn is coming and does not await the answer;
// spawning opencode is the expensive part of a cold turn, so doing it in parallel
// with the rest of the request (persist the message, reserve the permit, dispatch
// the command) takes it off the critical path.
//
// Idempotent by construction: it Acquires, never Claims or PostMessages, so it can
// neither start a turn nor duplicate one. Returns nil (204) once the detached warm
// is launched — a warm that failed is a warm that didn't help, not a request that
// failed, and the turn behind it reports its own problems.
func (rpc *RPC) HandleWarm(ctx context.Context, req *warmRequest) error {
	if !domain.IsValidConversationID(req.ConversationID) {
		return herr.New(ctx, domain.ErrInvalidConversationID, herr.M{"message": "invalid conversationId"})
	}
	ctx = clog.With(ctx, zap.String("conversation_id", req.ConversationID))

	creds := req.Credentials
	// The SAME merge chat does. The model is part of the credential signature, so
	// warming without it would spawn a worker the turn then discards.
	if mo := strings.TrimSpace(req.ModelOverride); mo != "" {
		creds.Model = mo
	}

	// Detach from the request: the caller does not await this, and we must not
	// abandon a half-spawned worker when it hangs up. clog.Go panic-guards the
	// goroutine (a bare `go func` would crash the process on a panic); the worker
	// runs on a fresh context that carries the request's logger but not its
	// cancellation, bounded so a wedged warm cannot leak a goroutine.
	conversationID, warmCreds := req.ConversationID, creds
	clog.Go(ctx, "langy-warm", func() {
		warmCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), warmTimeout)
		defer cancel()
		_ = rpc.app.Warm(warmCtx, conversationID, warmCreds)
	})
	return nil
}

// HandleProbe answers the control plane's pre-flight so it can skip minting a
// session key when a live worker would just discard it. A READ — it spawns
// nothing, claims nothing, mutates nothing. The answer is advisory (may be stale
// by the time the turn lands); Acquire is the authority and refuses a keyless
// spawn with ErrCredentialsRequired.
func (rpc *RPC) HandleProbe(ctx context.Context, req *probeRequest) (*probeResponse, error) {
	if !domain.IsValidConversationID(req.ConversationID) {
		return nil, herr.New(ctx, domain.ErrInvalidConversationID, herr.M{"message": "invalid conversationId"})
	}

	// Build the signature through the SAME function Acquire uses, so the probe can
	// never answer a question subtly different from the one that matters.
	sig := domain.SignatureOf(domain.Credentials{
		Model:           req.Model,
		GithubToken:     githubTokenSentinel(req.HasGithubAuth),
		EgressAllowlist: req.EgressAllowlist,
	})
	return &probeResponse{Alive: rpc.app.HasLiveWorker(req.ConversationID, sig)}, nil
}
