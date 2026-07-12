package rpc

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// chatRequest is the body shape /chat accepts. The control plane (Hono langy.ts
// route) is the only legitimate caller and is responsible for authn/authz of
// the end user; we only verify the shared internal bearer secret.
type chatRequest struct {
	ConversationID string `json:"conversationId" validate:"required"`
	Prompt         string `json:"prompt" validate:"required"`
	System         string `json:"system,omitempty"`
	// Credentials has no tag of its own — the validator descends into it and
	// checks its own `validate:"required"` fields (see domain.Credentials).
	Credentials   domain.Credentials `json:"credentials"`
	ModelOverride string             `json:"modelOverride,omitempty"`
	// ResumeToken (ADR-048) is an opaque, worker-authored checkpoint from a
	// prior turn that handed off on shutdown. The control plane sets it on the
	// next turn's /chat body when it found a pending handoff for the
	// conversation; the manager forwards it verbatim into the worker, never
	// parsing it. Absent ⇒ a normal cold start.
	ResumeToken string `json:"resumeToken,omitempty"`
	// TurnID is the control plane's per-turn idempotency key. The agent echoes it
	// back on the durable final POST. Not required: an older control plane omits
	// it, and the agent then skips the durable final (relay + reactor still run).
	TurnID string `json:"turnId,omitempty"`
	// ProjectID is the tenant the turn belongs to, echoed back on the durable
	// final so the ingest can dispatch the finalize command. Not required for the
	// same rollout reason as TurnID.
	ProjectID string `json:"projectId,omitempty"`
}

// warmRequest is /chat's body minus the turn: no prompt, no system, no resume
// token. Everything that feeds the worker's CREDENTIAL SIGNATURE is here and
// must match the turn that follows, or the worker this spawns is killed and
// respawned when the real /chat arrives.
type warmRequest struct {
	ConversationID string             `json:"conversationId" validate:"required"`
	Credentials    domain.Credentials `json:"credentials"`
	ModelOverride  string             `json:"modelOverride,omitempty"`
}

// warmHandler boots the conversation's worker ahead of the turn.
//
// The control plane calls this the instant it knows a turn is coming, and does
// not wait for the answer. Spawning opencode is the expensive part of a cold
// turn; doing it in parallel with the rest of the request (persisting the
// message, reserving the permit, dispatching the command through the event log)
// takes it off the critical path entirely.
//
// Idempotent by construction: it Acquires, and does not Claim or PostMessage, so
// it can neither start a turn nor duplicate one. Always 202 — a warm that failed
// is a warm that didn't help, not a request that failed, and the turn behind it
// reports its own problems.
func warmHandler(application *app.App, maxBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// A warm is best-effort: a body that can't be read or parsed just means no
		// warm (202), not a failed request — the turn behind it reports its own
		// problems.
		req, err := decode[warmRequest](w, r, maxBodyBytes)
		if err != nil {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		if !domain.IsValidConversationID(req.ConversationID) {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrInvalidConversationID, herr.M{"message": "invalid conversationId"}))
			return
		}

		creds := req.Credentials
		// The SAME merge /chat does. The model is part of the credential
		// signature, so warming without it would spawn a worker the turn then
		// discards.
		if mo := strings.TrimSpace(req.ModelOverride); mo != "" {
			creds.Model = mo
		}

		// Detach from the request: the caller does not await this, and we must
		// not abandon a half-spawned worker when it hangs up.
		go func() {
			warmCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), warmTimeout)
			defer cancel()
			_ = application.Warm(warmCtx, req.ConversationID, creds)
		}()

		w.WriteHeader(http.StatusAccepted)
	}
}

// warmTimeout bounds a detached spawn so a wedged warm cannot leak a goroutine.
const warmTimeout = 90 * time.Second

// chatHandler is the per-request worker dispatcher. Transport-only: it reads the
// body (capped at maxBodyBytes), validates inputs, and delegates the turn to the
// app. The app owns worker acquisition, streaming, and outcome mapping; the
// request context drives client-disconnect cancellation.
func chatHandler(application *app.App, maxBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// decode also struct-validates (required conversationId, prompt, and the
		// four mandatory credential fields), returning the field-naming herr.
		req, err := decode[chatRequest](w, r, maxBodyBytes)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		// Path-safety of conversationId is a separate, stricter check than
		// `required`: a non-empty value can still escape SESSIONS_ROOT.
		if !domain.IsValidConversationID(req.ConversationID) {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrInvalidConversationID, herr.M{"message": "invalid conversationId"}))
			return
		}

		creds := req.Credentials
		// Thread the user-selected/resolved model (already validated against the
		// project's allow-list by the control plane) into the worker config so
		// the picker actually takes effect. Model is bound at worker creation —
		// fixed per conversation, same as the JS manager.
		if mo := strings.TrimSpace(req.ModelOverride); mo != "" {
			creds.Model = mo
		}

		sink := newNDJSONSink(w)
		if err := application.Chat(ctx, app.ChatRequest{
			ConversationID: req.ConversationID,
			Prompt:         req.Prompt,
			System:         req.System,
			Credentials:    creds,
			ResumeToken:    req.ResumeToken,
			TurnID:         req.TurnID,
			ProjectID:      req.ProjectID,
		}, sink); err != nil {
			// Pre-stream failures only (e.g. conversation-busy → 409). Once the
			// stream has begun, the app writes error events into the sink and
			// returns nil.
			herr.WriteHTTP(w, err)
		}
	}
}

// healthAlias serves the legacy GET /health used by the control-plane preflight
// (langy.ts::isAgentHealthy) and the chart probes. It reports the worker count
// in the same text shape the flat manager used, so nothing downstream changes.
func healthAlias(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		active, max := application.Pool().Status()
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "ok (%d/%d workers)", active, max)
	}
}
