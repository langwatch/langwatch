package controlplane

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// ErrEmptySecret is returned when NewSigner is called with an empty secret.
var ErrEmptySecret = errors.New("signer: secret must not be empty")

// Signer signs outbound HTTP requests with the HMAC scheme
// shared with the LangWatch control plane.
type Signer struct {
	secret []byte
	nodeID string
}

// NewSigner creates an HMAC request signer. Returns an error if the
// secret is empty — unsigned requests to the control plane would be
// a security misconfiguration (fail closed).
func NewSigner(secret, nodeID string) (*Signer, error) {
	if secret == "" {
		return nil, ErrEmptySecret
	}
	return &Signer{secret: []byte(secret), nodeID: nodeID}, nil
}

// Sign adds HMAC signature headers to a request.
func (s *Signer) Sign(req *http.Request, body []byte) {
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
