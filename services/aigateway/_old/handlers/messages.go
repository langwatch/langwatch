package handlers

import (
	"net/http"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/dispatch"
	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

// Messages handles POST /v1/messages (Anthropic shape) — this is what Claude
// Code and Anthropic SDKs speak natively. We forward the raw request to the
// dispatcher which routes to Bifrost's Anthropic provider (preserving
// cache_control fields byte-for-byte — see spec).
type MessagesHandler struct {
	Dispatcher *dispatch.Dispatcher
}

func (h *MessagesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b := auth.BundleFromContext(r.Context())
	if b == nil {
		gwerrors.Write(w, httpx.IDFromContext(r.Context()),
			gwerrors.TypeInvalidAPIKey, "no_auth_context", "auth middleware did not attach a bundle", "")
		return
	}
	h.Dispatcher.ServeAnthropicMessages(w, r, b)
}
