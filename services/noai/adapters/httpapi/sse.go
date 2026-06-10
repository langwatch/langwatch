package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/langwatch/langwatch/services/noai/app"
)

// writeChatStream writes the /v1/chat/completions SSE response. Matches
// the OpenAI shape: `data: <json>` per chunk, terminated by `data: [DONE]`.
func writeChatStream(ctx context.Context, w http.ResponseWriter, req app.ChatRequest, now time.Time) {
	prepareSSEHeaders(w)
	flusher, _ := w.(http.Flusher)
	chunks := app.BuildChatStreamChunks(ctx, req, now)
	for _, chunk := range chunks {
		writeDataLine(w, chunk)
		if flusher != nil {
			flusher.Flush()
		}
	}
	fmt.Fprint(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

// writeResponsesStream writes the /v1/responses SSE response. The
// Responses API uses typed `event:` lines (no terminal sentinel —
// `response.completed` is the cue).
func writeResponsesStream(ctx context.Context, w http.ResponseWriter, req app.ResponsesRequest, now time.Time) {
	prepareSSEHeaders(w)
	flusher, _ := w.(http.Flusher)
	for _, ev := range app.BuildResponsesStreamEvents(ctx, req, now) {
		fmt.Fprintf(w, "event: %s\n", ev.Event)
		body, _ := json.Marshal(ev.Data)
		fmt.Fprintf(w, "data: %s\n\n", body)
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func prepareSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
}

func writeDataLine(w http.ResponseWriter, v any) {
	body, _ := json.Marshal(v)
	fmt.Fprintf(w, "data: %s\n\n", body)
}
