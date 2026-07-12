package rpc

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	httprpc "github.com/langwatch/langwatch/pkg/rpc"
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
	// RunToken is the per-conversation secret (frameauth) the manager SIGNS every
	// pushed output frame with. Minted server-only at conversation_started,
	// injected here at dispatch, and NEVER echoed back on the wire — the HMAC
	// proves possession without re-transmitting it. Absent ⇒ an older control
	// plane; the manager cannot sign frames and skips the relay push.
	RunToken string `json:"runToken,omitempty"`
	// UserID scopes the signed frame identity to the human the conversation
	// belongs to (Langy is a per-user private surface, not just project-scoped).
	// Part of the frameauth identity tuple; omitted by an older control plane.
	UserID string `json:"userId,omitempty"`
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

// warmTimeout bounds a detached spawn so a wedged warm cannot leak a goroutine.
// Consumed by RPC.HandleWarm.
const warmTimeout = 90 * time.Second

// Worker-turn intent labels. The control plane picks one per turn as a semantic
// hint — the manager runs the SAME turn logic for all three (Acquire reconciles
// create/reuse/revive internally), and the label is recorded on the turn's logs +
// metrics so per-intent latency and volume are visible. create = expects a cold
// spawn (a session key rode along); revive = resume a prior turn's handoff
// checkpoint (resumeToken present); continue = reuse a live worker (no key, the
// caller's probe said one was alive). The caller can guess wrong — it is a label,
// not a command — and the turn still runs correctly.
const (
	workerIntentCreate   = "create"
	workerIntentRevive   = "revive"
	workerIntentContinue = "continue"
)

// maxTurnDuration bounds a detached turn so a wedged opencode stream (one that
// never sends a terminal event) cannot leak the drive goroutine forever. It is a
// generous ceiling well above any realistic turn — the turn normally ends on its
// terminal frame long before this fires.
const maxTurnDuration = 30 * time.Minute

// chatHandler is the per-request worker dispatcher. Transport-only: it reads the
// body (capped at maxBodyBytes), validates inputs, and runs the SYNCHRONOUS half
// of the turn (StartTurn: acquire + claim) so pre-stream outcomes come back as
// HTTP statuses. On success it returns 202 and drives the turn on a detached,
// panic-guarded goroutine — the turn's output flows out-of-band as signed frames
// to the relay, so the client is not held open for it. intent is the route's
// worker-turn label (one of workerIntent*), recorded on the turn's logs + metrics.
func chatHandler(application *app.App, maxBodyBytes int64, intent string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// decode also struct-validates (required conversationId, prompt, and the
		// four mandatory credential fields), returning the field-naming herr.
		req, err := httprpc.Decode[chatRequest](w, r, maxBodyBytes)
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

		// Stamp the turn's identity + intent onto the context logger so every line
		// the app, pool, worker, and opencode reader emit for this turn carries it —
		// the thread to pull when reading logs for one conversation.
		ctx = clog.With(ctx, turnLogFields(req.ConversationID, req.ProjectID, req.TurnID)...)
		ctx = clog.With(ctx, zap.String("worker_intent", intent))

		creds := req.Credentials
		// Thread the user-selected/resolved model (already validated against the
		// project's allow-list by the control plane) into the worker config so
		// the picker actually takes effect. Model is bound at worker creation —
		// fixed per conversation, same as the JS manager.
		if mo := strings.TrimSpace(req.ModelOverride); mo != "" {
			creds.Model = mo
		}

		run, err := application.StartTurn(ctx, app.ChatRequest{
			ConversationID: req.ConversationID,
			Prompt:         req.Prompt,
			System:         req.System,
			Credentials:    creds,
			ResumeToken:    req.ResumeToken,
			TurnID:         req.TurnID,
			ProjectID:      req.ProjectID,
			RunToken:       req.RunToken,
			UserID:         req.UserID,
			Intent:         intent,
		})
		if err != nil {
			// Pre-stream outcome: conversation-busy → 409, at-capacity → 503,
			// credentials-required → 428, invalid conversationId → 400.
			herr.WriteHTTP(w, err)
			return
		}

		// Accepted: the worker is claimed. Detach the drive from the request (the
		// 202 ends it) with a panic guard, bounded by maxTurnDuration so a wedged
		// stream cannot leak the goroutine.
		w.WriteHeader(http.StatusAccepted)
		clog.Go(ctx, "langy-turn", func() {
			turnCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), maxTurnDuration)
			defer cancel()
			run(turnCtx)
		})
	}
}

// turnLogFields builds the context-logger fields that identify a turn. Only
// conversationId is guaranteed present; projectId and turnId are omitted when a
// caller (an older control plane, or the warm/probe pre-flights) does not send
// them, so a nil/empty field never clutters the logs.
func turnLogFields(conversationID, projectID, turnID string) []zap.Field {
	fields := []zap.Field{zap.String("conversation_id", conversationID)}
	if projectID != "" {
		fields = append(fields, zap.String("project_id", projectID))
	}
	if turnID != "" {
		fields = append(fields, zap.String("turn_id", turnID))
	}
	return fields
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
