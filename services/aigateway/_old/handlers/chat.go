package handlers

import (
	"net/http"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/dispatch"
	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

// ChatCompletions handles POST /v1/chat/completions (OpenAI shape).
// Streaming is detected via `stream: true` in the JSON body and dispatched
// through the SSE path.
//
// Wire-level behavior is documented in specs/ai-gateway/request-dispatch.feature.
type ChatHandler struct {
	Dispatcher *dispatch.Dispatcher
}

func (h *ChatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b := auth.BundleFromContext(r.Context())
	if b == nil {
		gwerrors.Write(w, httpx.IDFromContext(r.Context()),
			gwerrors.TypeInvalidAPIKey, "no_auth_context", "auth middleware did not attach a bundle", "")
		return
	}
	h.Dispatcher.ServeChatCompletions(w, r, b)
}
