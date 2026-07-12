package rpc

import (
	"context"
	"encoding/json"
	"net/http"
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
// http.ResponseWriter. The generic adapters below (handle / handleNoContent) do
// the plumbing: decode+validate the body, call the method, then serialize the
// result (a herr via herr.WriteHTTP, a nil response as 204, else the response as
// JSON). Streaming verbs (chat) do NOT fit this shape and stay bespoke handlers.
type RPC struct {
	app          *app.App
	maxBodyBytes int64
}

// NewRPC builds the typed RPC surface over the app.
func NewRPC(application *app.App, maxBodyBytes int64) *RPC {
	return &RPC{app: application, maxBodyBytes: maxBodyBytes}
}

// handle adapts a typed method that returns a response body. The body is decoded
// + validated into Req; on a herr from either the decode or the method it writes
// the herr envelope; a nil *Resp becomes 204 No Content; otherwise the response
// is JSON-encoded.
func handle[Req, Resp any](maxBodyBytes int64, fn func(context.Context, *Req) (*Resp, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := decode[Req](w, r, maxBodyBytes)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		resp, err := fn(r.Context(), &req)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		if resp == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// handleNoContent adapts a typed method with no response body: success is 204, a
// herr (from decode or the method) is written as the herr envelope.
func handleNoContent[Req any](maxBodyBytes int64, fn func(context.Context, *Req) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := decode[Req](w, r, maxBodyBytes)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		if err := fn(r.Context(), &req); err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
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
