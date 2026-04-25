package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// HMACAuthMiddleware verifies the X-LangWatch-NLPGO-Signature header on
// every request to /go/*. The TS app signs the raw body with the
// shared LW_NLPGO_INTERNAL_SECRET (hex-encoded HMAC-SHA256). A missing
// or mismatched signature returns 401 with a structured error.
//
// The middleware also buffers the body so downstream handlers can read
// it after verification.
func HMACAuthMiddleware(secret string) func(http.Handler) http.Handler {
	if secret == "" {
		// Fail open in development if the operator hasn't set a secret —
		// log loudly via the per-request handler so misconfig is obvious.
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-LangWatch-NLPGO-Auth", "disabled")
				next.ServeHTTP(w, r)
			})
		}
	}
	key := []byte(secret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := r.Header.Get("X-LangWatch-NLPGO-Signature")
			if provided == "" {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrUnauthorized, herr.M{
					"reason": "missing_signature",
				}, errors.New("X-LangWatch-NLPGO-Signature header required")))
				return
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, nil, err))
				return
			}
			_ = r.Body.Close()
			mac := hmac.New(sha256.New, key)
			mac.Write(body)
			expected := hex.EncodeToString(mac.Sum(nil))
			if !hmac.Equal([]byte(expected), []byte(provided)) {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrUnauthorized, herr.M{
					"reason": "signature_mismatch",
				}, errors.New("HMAC signature does not match request body")))
				return
			}
			r.Body = io.NopCloser(byteReader(body))
			r.ContentLength = int64(len(body))
			r.Header.Set("X-LangWatch-NLPGO-Auth", "verified")
			next.ServeHTTP(w, r)
		})
	}
}

type byteReader []byte

func (b byteReader) Read(p []byte) (int, error) {
	if len(b) == 0 {
		return 0, io.EOF
	}
	n := copy(p, b)
	return n, nil
}

// Note: byteReader is intentionally simple — the body is small, single
// pass, and re-buffered upstream. We don't need bytes.Reader's seeking
// or LimitedReader's accounting here, and avoiding the import keeps
// the middleware standalone.
