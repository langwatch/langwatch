package authcache

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"
)

// Signer signs outbound HTTP requests with the HMAC scheme shared
// with the control plane. Reusable by budget, guardrails, etc.
type Signer struct {
	secret []byte
	nodeID string
}

// NewSigner creates an HMAC request signer.
func NewSigner(secret, nodeID string) *Signer {
	return &Signer{secret: []byte(secret), nodeID: nodeID}
}

// Sign adds HMAC signature headers to a request. No-op if secret is empty.
func (s *Signer) Sign(req *http.Request, body []byte) {
	if len(s.secret) == 0 {
		return
	}
	ts := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(ts))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))

	req.Header.Set("X-Gateway-Timestamp", ts)
	req.Header.Set("X-Gateway-Signature", sig)
	if s.nodeID != "" {
		req.Header.Set("X-Gateway-Node-ID", s.nodeID)
	}
}
