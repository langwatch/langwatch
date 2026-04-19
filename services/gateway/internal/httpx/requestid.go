package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

type ctxKey int

const requestIDKey ctxKey = iota

const headerName = "X-LangWatch-Request-Id"

// RequestID middleware ensures every request has an X-LangWatch-Request-Id
// header. Clients may pass their own (logged and echoed) or we generate one.
// The id is always 34 chars: "req_" + 30 hex chars (15 random bytes).
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(headerName)
		if id == "" {
			id = newID()
		}
		w.Header().Set(headerName, id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// IDFromContext returns the request id, or "" if absent.
func IDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

func newID() string {
	var b [15]byte
	_, _ = rand.Read(b[:])
	return "req_" + hex.EncodeToString(b[:])
}
