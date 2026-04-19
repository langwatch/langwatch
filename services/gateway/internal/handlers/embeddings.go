package handlers

import (
	"net/http"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/dispatch"
	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

type EmbeddingsHandler struct {
	Dispatcher *dispatch.Dispatcher
}

func (h *EmbeddingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b := auth.BundleFromContext(r.Context())
	if b == nil {
		gwerrors.Write(w, httpx.IDFromContext(r.Context()),
			gwerrors.TypeInvalidAPIKey, "no_auth_context", "auth middleware did not attach a bundle", "")
		return
	}
	h.Dispatcher.ServeEmbeddings(w, r, b)
}
