package httpmiddleware

import (
	"net/http"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
)

// Recover catches panics per-request. Logs the panic with full context,
// returns a generic 500 to the client (never exposes panic internals),
// then re-panics so net/http tears down the connection cleanly.
func Recover() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if v := recover(); v != nil {
					ctx := clog.With(r.Context(),
						zap.String("path", r.URL.Path),
						zap.String("method", r.Method),
						zap.String("request_id", GetRequestID(r.Context())),
						zap.String("remote", r.RemoteAddr),
					)

					// Generic error to client — never expose panic details
					herr.WriteHTTP(w, herr.New(ctx, "internal_error", nil))

					// Log full panic + re-panic for net/http
					defer clog.HandlePanic(ctx, true)
					panic(v)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
