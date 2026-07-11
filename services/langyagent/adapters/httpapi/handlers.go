package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// chatRequest is the body shape /chat accepts. The control plane (Hono langy.ts
// route) is the only legitimate caller and is responsible for authn/authz of
// the end user; we only verify the shared internal bearer secret.
type chatRequest struct {
	ConversationID string             `json:"conversationId"`
	Prompt         string             `json:"prompt"`
	System         string             `json:"system,omitempty"`
	Credentials    domain.Credentials `json:"credentials"`
	ModelOverride  string             `json:"modelOverride,omitempty"`
}

// chatHandler is the per-request worker dispatcher. Transport-only: it reads the
// body (capped at maxBodyBytes), validates inputs, and delegates the turn to the
// app. The app owns worker acquisition, streaming, and outcome mapping; the
// request context drives client-disconnect cancellation.
func chatHandler(application *app.App, maxBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
		if err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				herr.WriteHTTP(w, herr.New(ctx, domain.ErrPayloadTooLarge, herr.M{"message": "request body too large"}))
				return
			}
			// The raw read error goes in reasons: it's logged by the telemetry
			// middleware but WriteHTTP replaces non-herr reasons with "unknown"
			// for the client, so no transport internals leak into the response.
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrBadRequest, herr.M{"message": "could not read the request body"}, err))
			return
		}

		var req chatRequest
		if err := json.Unmarshal(body, &req); err != nil {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrBadRequest, herr.M{"message": "invalid JSON body"}))
			return
		}
		if req.ConversationID == "" || req.Prompt == "" {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrBadRequest, herr.M{
				"message": "missing required: conversationId, prompt, credentials",
			}))
			return
		}
		if !domain.IsValidConversationID(req.ConversationID) {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrInvalidConversationID, herr.M{"message": "invalid conversationId"}))
			return
		}
		if !req.Credentials.Complete() {
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrBadRequest, herr.M{
				"message": "credentials must include langwatchApiKey, llmVirtualKey, gatewayBaseUrl, langwatchEndpoint",
			}))
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
