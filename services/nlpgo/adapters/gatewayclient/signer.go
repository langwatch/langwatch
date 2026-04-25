// Package gatewayclient is nlpgo's HTTP client for the LangWatch AI Gateway.
//
// nlpgo holds per-request customer credentials (extracted from the Studio
// workflow node by the TS app) and forwards them to the gateway via the
// inbound inline-credentials HMAC path defined in the gateway's
// services/aigateway/adapters/httpapi/internal_auth.go and documented in
// specs/nlp-go/_shared/contract.md §8.1.
//
// The client implements services/nlpgo/app.GatewayClient.
package gatewayclient

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"time"
)

// Header names — these MUST match the gateway-side InternalAuthMiddleware
// constants in services/aigateway/adapters/httpapi/internal_auth.go.
const (
	HeaderInternalAuth         = "X-LangWatch-Internal-Auth"
	HeaderInternalTimestamp    = "X-LangWatch-Internal-Timestamp"
	HeaderInlineCredentials    = "X-LangWatch-Inline-Credentials"
	HeaderProjectID            = "X-LangWatch-Project-Id"
	HeaderOrigin               = "X-LangWatch-Origin"
	HeaderTraceID              = "X-LangWatch-Trace-Id"
	HeaderRequestID            = "X-LangWatch-Request-Id"
)

// ErrEmptySecret is returned when NewSigner is called with no secret.
var ErrEmptySecret = errors.New("gatewayclient: secret must not be empty")

// Signer adds inline-credentials HMAC headers to outbound gateway requests.
// The canonical input is identical to the gateway-side verifier:
//
//	METHOD\nPATH\nTIMESTAMP\nhex(sha256(BODY))\nhex(sha256(INLINE_CREDS_HEADER))
//
// Caller must have already set HeaderInlineCredentials on req before
// calling Sign — the credentials value participates in the signature.
type Signer struct {
	secret []byte
}

// NewSigner returns a Signer for the given shared secret. Empty secret
// returns ErrEmptySecret — sending unsigned requests would 401 anyway.
func NewSigner(secret string) (*Signer, error) {
	if secret == "" {
		return nil, ErrEmptySecret
	}
	return &Signer{secret: []byte(secret)}, nil
}

// Sign mutates req to add the auth + timestamp headers. The body byte
// slice must match the bytes the request will actually transmit; the
// caller is responsible for keeping body and req.Body in sync.
func (s *Signer) Sign(req *http.Request, body []byte) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	credsHeader := req.Header.Get(HeaderInlineCredentials)

	bodyHash := sha256.Sum256(body)
	credsHash := sha256.Sum256([]byte(credsHeader))

	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(req.Method))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(req.URL.Path))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(ts))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(hex.EncodeToString(bodyHash[:])))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(hex.EncodeToString(credsHash[:])))

	req.Header.Set(HeaderInternalTimestamp, ts)
	req.Header.Set(HeaderInternalAuth, hex.EncodeToString(mac.Sum(nil)))
}
