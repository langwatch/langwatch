package httpx

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

// Recover middleware catches panics, emits a structured log, and returns a
// canonical 500 envelope rather than letting the connection die.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					logger.Error("panic",
						"panic", rec,
						"path", r.URL.Path,
						"method", r.Method,
						"request_id", IDFromContext(r.Context()),
						"stack", string(debug.Stack()),
					)
					gwerrors.Write(w, IDFromContext(r.Context()),
						gwerrors.TypeInternalError,
						"panic",
						"internal server error",
						"")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
