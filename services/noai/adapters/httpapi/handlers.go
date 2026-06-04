package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/noai/app"
)

// chatCompletionsHandler serves POST /v1/chat/completions, branching to
// the streaming or non-streaming writer based on the `stream` field.
func chatCompletionsHandler(logger *zap.Logger, maxBody int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req app.ChatRequest
		if err := decodeJSON(r, maxBody, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
			return
		}
		if req.Model == "" {
			writeError(w, http.StatusBadRequest, "invalid_request_error", "missing required field: model")
			return
		}
		if !app.IsKnown(req.Model) {
			logger.Warn("noai_unknown_model_chat", zap.String("model", req.Model))
		}
		now := time.Now()
		if req.Stream {
			writeChatStream(w, r.Context(), req, now)
			return
		}
		writeJSON(w, http.StatusOK, app.BuildChatResponse(r.Context(), req, now))
	}
}

// responsesHandler serves POST /v1/responses, also branching on stream.
func responsesHandler(logger *zap.Logger, maxBody int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req app.ResponsesRequest
		if err := decodeJSON(r, maxBody, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
			return
		}
		if req.Model == "" {
			writeError(w, http.StatusBadRequest, "invalid_request_error", "missing required field: model")
			return
		}
		if !app.IsKnown(req.Model) {
			logger.Warn("noai_unknown_model_responses", zap.String("model", req.Model))
		}
		now := time.Now()
		if req.Stream {
			writeResponsesStream(w, r.Context(), req, now)
			return
		}
		writeJSON(w, http.StatusOK, app.BuildResponsesResult(r.Context(), req, now))
	}
}

// listModelsHandler returns every noai model under the `langwatch_noai/`
// prefix. Mirrors GET /v1/models on real OpenAI: clients (LiteLLM,
// playgrounds, the gateway) use this to populate dropdowns.
func listModelsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		type modelEntry struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			OwnedBy string `json:"owned_by"`
			Created int64  `json:"created"`
		}
		entries := make([]modelEntry, 0, len(app.All()))
		for _, m := range app.All() {
			entries = append(entries, modelEntry{
				ID:      "langwatch_noai/" + string(m),
				Object:  "model",
				OwnedBy: "langwatch-noai",
				Created: 0,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"object": "list",
			"data":   entries,
		})
	}
}

// ---------- helpers ----------

func decodeJSON(r *http.Request, maxBody int64, dst any) error {
	// http.MaxBytesReader requires a non-nil ResponseWriter (it calls
	// WriteHeader on overflow). io.LimitReader gives the same cap with
	// a clean io.EOF instead of a panic — fine for this dev-only service.
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return err
	}
	if int64(len(body)) > maxBody {
		return fmt.Errorf("request body exceeds %d bytes", maxBody)
	}
	if len(body) == 0 {
		return errors.New("empty request body")
	}
	return json.Unmarshal(body, dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"message": message,
			"type":    code,
			"code":    code,
		},
	})
}
