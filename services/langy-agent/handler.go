package langyagent

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go.uber.org/zap"
)

// chatRequest is the body shape /chat accepts. The control plane (Hono
// langy.ts route) is the only legitimate caller and is responsible for
// authn/authz of the end user; we only verify the shared Bearer secret.
type chatRequest struct {
	ConversationID string      `json:"conversationId"`
	Prompt         string      `json:"prompt"`
	System         string      `json:"system,omitempty"`
	Credentials    Credentials `json:"credentials"`
	ModelOverride  string      `json:"modelOverride,omitempty"`
}

// errorEvent serialises an "error" ndjson event in the same shape the JS
// manager emitted, so the control-plane stream consumer is bit-compatible.
type errorEvent struct {
	Type  string `json:"type"`
	Error string `json:"error"`
}

func writeErrorEvent(w http.ResponseWriter, msg string) {
	b, _ := json.Marshal(errorEvent{Type: "error", Error: msg})
	_, _ = w.Write(append(b, '\n'))
}

// newRouter wires the two HTTP endpoints. Kept tiny — auth + dispatch only.
func newRouter(mgr *Manager, cfg Config, log *zap.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		active, max := mgr.Status()
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "ok (%d/%d workers)", active, max)
	})
	mux.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleChat(w, r, mgr, cfg, log)
	})
	return mux
}

// handleChat is the per-request worker dispatcher. Reads the body (capped
// at cfg.MaxBodyBytes), validates inputs, gets/creates the worker, posts
// the prompt, and forwards the SSE event stream as ndjson back to the
// caller. The request context drives client-disconnect cancellation —
// streamSessionEvents threads it into the upstream fetch so a disconnect
// kills the upstream socket immediately rather than waiting for opencode
// to send a byte.
func handleChat(w http.ResponseWriter, r *http.Request, mgr *Manager, cfg Config, log *zap.Logger) {
	if h := r.Header.Get("Authorization"); h != "Bearer "+cfg.InternalSecret {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, cfg.MaxBodyBytes))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body too large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read body: " + err.Error()})
		return
	}

	var req chatRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if req.ConversationID == "" || req.Prompt == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required: conversationId, prompt, credentials"})
		return
	}
	if !isValidConversationID(req.ConversationID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid conversationId"})
		return
	}
	creds := req.Credentials
	if creds.LangwatchAPIKey == "" || creds.LLMVirtualKey == "" ||
		creds.GatewayBaseURL == "" || creds.LangwatchEndpoint == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "credentials must include langwatchApiKey, llmVirtualKey, gatewayBaseUrl, langwatchEndpoint",
		})
		return
	}

	// Thread the user-selected/resolved model (already validated against the
	// project's allow-list by the control plane) into the worker config so
	// the picker actually takes effect. Model is bound at worker creation —
	// fixed per conversation, same as the JS manager.
	if mo := strings.TrimSpace(req.ModelOverride); mo != "" {
		creds.Model = mo
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)
	flush := func() {
		if flusher != nil {
			flusher.Flush()
		}
	}

	ctx := r.Context()

	worker, err := mgr.Get(ctx, req.ConversationID, creds)
	if err != nil {
		if errors.Is(err, ErrMaxWorkers) {
			w.WriteHeader(http.StatusOK)
			writeErrorEvent(w, "at-capacity")
			flush()
			return
		}
		log.Error("get worker failed",
			zap.String("conversation", req.ConversationID),
			zap.Error(err),
		)
		w.WriteHeader(http.StatusOK)
		writeErrorEvent(w, err.Error())
		flush()
		return
	}
	worker.touch()

	w.WriteHeader(http.StatusOK)

	// Kick the SSE consumer first so we don't lose the first delta if
	// opencode is fast to start producing.
	errCh := make(chan error, 1)
	go func() {
		errCh <- streamSessionEvents(ctx, worker.port, worker.openCodeSessionID, w, flush)
	}()

	if err := postMessage(ctx, worker.port, worker.openCodeSessionID, req.System, req.Prompt); err != nil {
		if errors.Is(err, errSessionNotFound) {
			mgr.KillSessionVanished(req.ConversationID)
			writeErrorEvent(w, "session-not-found")
			flush()
			<-errCh // let the stream consumer unwind.
			return
		}
		log.Error("post message failed",
			zap.String("conversation", req.ConversationID),
			zap.Error(err),
		)
		writeErrorEvent(w, err.Error())
		flush()
		<-errCh
		return
	}

	if err := <-errCh; err != nil {
		log.Warn("stream events ended with error",
			zap.String("conversation", req.ConversationID),
			zap.Error(err),
		)
		writeErrorEvent(w, err.Error())
		flush()
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
