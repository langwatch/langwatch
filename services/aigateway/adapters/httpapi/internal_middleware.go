package httpapi

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// gatewaySignatureWindowSeconds matches `GATEWAY_SIGNATURE_WINDOW_SECONDS`
// in `langwatch/src/server/routes/gateway-internal.ts`. Both ends must
// use the same value or replay protection becomes asymmetric.
const gatewaySignatureWindowSeconds = 300

// InternalAuthMiddleware verifies the HMAC-signed channel between the
// LangWatch control plane and this gateway. It is the inbound mirror of
// `controlplane.Signer` — the gateway signs outbound calls to the
// control plane with the same scheme — and matches the verifier in
// `gateway-internal.ts`.
//
// Canonical signing string (constant across both directions):
//
//	METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
//
// Headers (matching `langwatch/ee/governance/services/activity-monitor/ottlGatewayClient.ts`):
//
//	X-LangWatch-Gateway-Signature  hex(hmac_sha256(secret, canonical))
//	X-LangWatch-Gateway-Timestamp  unix seconds (±300s window)
//	X-LangWatch-Gateway-Node       advisory, unsigned
//
// Verification order:
//  1. Missing headers → 401 (cheap)
//  2. Signature compare (constant-time) → 401 if bad
//  3. Timestamp window check → 401 if drifted
//
// Doing the HMAC compare before the timestamp prevents a timing-side
// channel from leaking which check failed (invalid sig vs replayed
// request). Same ordering as `gateway-internal.ts`.
//
// Fail-closed if the secret isn't configured: the /internal/* surface
// is always reachable from the control plane and unsigned access would
// be a security misconfiguration.
func InternalAuthMiddleware(secret string) func(http.Handler) http.Handler {
	if secret == "" {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
					"message": "LW_GATEWAY_INTERNAL_SECRET not configured; /internal/* refused",
				}))
			})
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			presentedSig := r.Header.Get("X-LangWatch-Gateway-Signature")
			presentedTs := r.Header.Get("X-LangWatch-Gateway-Timestamp")
			if presentedSig == "" || presentedTs == "" {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"code":    "missing_signature",
					"message": "X-LangWatch-Gateway-Signature and X-LangWatch-Gateway-Timestamp are required",
				}))
				return
			}

			// Buffer the body once so the downstream handler can re-read it.
			// /internal/* payloads are small (statements + base64 OTLP),
			// well within the 32MB ceiling enforced inside the handlers.
			body, err := io.ReadAll(r.Body)
			if err != nil {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
					"message": "failed to read request body",
				}))
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))

			expected := computeSignature(secret, r.Method, r.URL.Path, presentedTs, body)
			if !constantTimeHexEqual(expected, presentedSig) {
				clog.Get(r.Context()).Warn("internal_auth_signature_mismatch",
					zap.String("path", r.URL.Path),
					zap.String("node", r.Header.Get("X-LangWatch-Gateway-Node")),
				)
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"code":    "invalid_signature",
					"message": "signature mismatch",
				}))
				return
			}

			ts, err := strconv.ParseInt(presentedTs, 10, 64)
			if err != nil {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"code":    "invalid_timestamp",
					"message": "X-LangWatch-Gateway-Timestamp must be unix seconds",
				}))
				return
			}
			now := time.Now().Unix()
			drift := now - ts
			if drift < 0 {
				drift = -drift
			}
			if drift > gatewaySignatureWindowSeconds {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"code":    "timestamp_out_of_window",
					"message": "timestamp drift exceeds replay window",
				}))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// computeSignature returns hex(hmac_sha256(secret, METHOD\nPATH\nTS\nhex(sha256(body)))).
// The body hash is hex-encoded inside the canonical string so it
// matches the TS verifier byte-for-byte (which uses
// `createHash('sha256').digest('hex')`).
func computeSignature(secret, method, path, ts string, body []byte) string {
	bodyHash := sha256.Sum256(body)
	bodyHashHex := make([]byte, hex.EncodedLen(len(bodyHash)))
	hex.Encode(bodyHashHex, bodyHash[:])

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(method))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(path))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(ts))
	mac.Write([]byte{'\n'})
	mac.Write(bodyHashHex)

	sig := mac.Sum(nil)
	return hex.EncodeToString(sig)
}

// constantTimeHexEqual compares two hex strings in constant time.
// hmac.Equal handles short-circuiting on length mismatch — but we
// still want a length-prefix check so the eventual diff isn't biased
// by case differences ("ABC" vs "abc") leaking through hex.DecodeString.
func constantTimeHexEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return hmac.Equal([]byte(a), []byte(b))
}

// ErrEmptySecret is returned when the middleware is constructed with
// an empty secret — exposed so callers can distinguish that from
// generic config errors.
var ErrEmptySecret = errors.New("internal_auth: secret must not be empty")
