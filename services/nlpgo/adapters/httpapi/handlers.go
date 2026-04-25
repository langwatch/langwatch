package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// executeSyncHandler is the entry point for /go/studio/execute_sync.
// During the scaffold phase it returns 501; the real engine wires in
// once the dsl + executor land.
func executeSyncHandler(_ *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
			"reason": "engine_not_implemented",
			"path":   r.URL.Path,
		}))
	}
}

// executeStreamHandler is the entry point for /go/studio/execute (SSE).
// Scaffold returns 501.
func executeStreamHandler(_ *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
			"reason": "engine_not_implemented",
			"path":   r.URL.Path,
		}))
	}
}

// proxyPassthroughHandler reverse-proxies /go/proxy/v1/* into the AI
// Gateway. Scaffold returns 501; the real implementation forwards via
// httputil.ReverseProxy after authenticating with the gateway internal
// secret.
func proxyPassthroughHandler(_ *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
			"reason": "gateway_proxy_not_implemented",
			"path":   r.URL.Path,
		}))
	}
}

// versionHandler echoes basic identity so callers can verify they're
// talking to nlpgo and not the Python upstream by accident.
func versionHandler(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"service": "nlpgo",
			"version": version,
		})
	}
}
