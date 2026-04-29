package httpmiddleware

import (
	"errors"
	"net/http"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
)

// Recover catches panics per-request. Logs the panic with full context,
// returns a generic 500 to the client (never exposes panic internals),
// then re-panics so net/http tears down the connection cleanly.
//
// Special case: http.ErrAbortHandler is a sentinel panic the standard
// library uses to signal "abort this request, do not write further
// output, and tear the connection down." Triggered most commonly by
// httputil.ReverseProxy when the upstream connection EOFs mid-body.
// We must NOT write a 500 response in that case — the response writer
// is in an indeterminate state, the additional WriteHeader call logs
// "superfluous response.WriteHeader" warnings, and on AWS Lambda the
// Rust-based Lambda Web Adapter dies with "unexpected EOF during chunk
// size line" when the wire shape goes inconsistent, taking the whole
// container down. Bare-re-panic the sentinel so net/http handles it
// per its documented contract (close the connection, no logging).
//
// Observed live in lw-dev probes against the saas Lambda runtime image
// on 2026-04-28: a /studio/execute proxy through to a uvicorn child
// that crashed mid-stream produced ErrAbortHandler → wrote a 500 →
// LWA extension SIGKILL → Lambda billed 49s/Extension.Crash.
func Recover() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					// Re-panic without touching the response writer.
					// net/http's serve loop catches this sentinel and
					// closes the connection silently. Use errors.Is
					// (not direct ==) so a wrapped ErrAbortHandler from
					// a deeper handler is still caught — errorlint
					// flags the bare equality check.
					panic(v)
				}

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
			}()
			next.ServeHTTP(w, r)
		})
	}
}
