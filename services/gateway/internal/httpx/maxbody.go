package httpx

import (
	"errors"
	"net/http"

	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

// MaxBodyBytes caps the size of the request body to protect the pod
// from OOM on a multi-GB or infinite-stream body. Two gates:
//
//  1. If Content-Length is declared and already exceeds the cap, reject
//     immediately with 413 without draining the socket.
//  2. Otherwise wrap r.Body with http.MaxBytesReader so any downstream
//     io.ReadAll / json.NewDecoder.Decode hits a clean MaxBytesError at
//     the cap. Handlers that check for *http.MaxBytesError surface the
//     correct 413 to the caller; handlers that don't still see a fast
//     EOF and won't OOM.
//
// Zero or negative limit disables the middleware (passthrough).
func MaxBodyBytes(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if limit <= 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > limit {
				reqID := IDFromContext(r.Context())
				gwerrors.Write(w, reqID, gwerrors.TypePayloadTooLarge,
					"payload_too_large",
					"request body exceeds the configured maximum", "")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// IsMaxBytesError reports whether err is the sentinel returned by
// http.MaxBytesReader when a handler's body-read hit the cap. Handlers
// should map this to gwerrors.TypePayloadTooLarge rather than a generic
// bad_request so operators and clients can distinguish the two.
func IsMaxBytesError(err error) bool {
	var mbe *http.MaxBytesError
	return errors.As(err, &mbe)
}
