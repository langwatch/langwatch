package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// validate is the shared struct validator for the /chat body. It is safe for
// concurrent use and caches struct reflection, so it is built once.
var validate = validator.New()

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
}

// validateChatRequest checks the decoded body against its `validate` tags. On
// failure it returns a herr(ErrBadRequest) that NAMES the offending fields for
// internal diagnostics (logged + carried in Meta) while the user-facing message
// stays generic — the raw validator error is never surfaced to the caller.
func validateChatRequest(ctx context.Context, req chatRequest) error {
	err := validate.Struct(req)
	if err == nil {
		return nil
	}
	ve, ok := err.(validator.ValidationErrors)
	if !ok {
		// Non-field validator failure (misconfigured tag). Keep the detail in a
		// logged reason; the client still gets a generic message.
		return herr.New(ctx, domain.ErrBadRequest, herr.M{"message": "the request body was invalid"}, err)
	}
	fields := make([]string, 0, len(ve))
	for _, fe := range ve {
		fields = append(fields, validationFieldPath(fe))
	}
	clog.Get(ctx).Warn("chat request validation failed", zap.Strings("fields", fields))
	return herr.New(ctx, domain.ErrBadRequest, herr.M{
		"message": "the request was missing or contained invalid required fields",
		"fields":  fields,
	})
}

// validationFieldPath renders a validator field error as its struct path with
// the root type stripped (e.g. "Credentials.LangwatchAPIKey"), naming exactly
// which part of the /chat schema failed.
func validationFieldPath(fe validator.FieldError) string {
	ns := fe.StructNamespace()
	if i := strings.IndexByte(ns, '.'); i >= 0 {
		return ns[i+1:]
	}
	return ns
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
		// Structural validation (required conversationId, prompt, and the four
		// mandatory credential fields) in one pass — the herr names the offending
		// field for diagnostics with a generic user message.
		if err := validateChatRequest(ctx, req); err != nil {
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
