package controlplane

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// ErrEmptySecret is returned when NewSigner is called with an empty secret.
var ErrEmptySecret = errors.New("signer: secret must not be empty")

// Signer signs outbound HTTP requests with the HMAC scheme
// shared with the LangWatch control plane.
type Signer struct {
	secret  []byte
	nodeID  string
	macPool sync.Pool
}

// NewSigner creates an HMAC request signer. Returns an error if the
// secret is empty — unsigned requests to the control plane would be
// a security misconfiguration (fail closed).
func NewSigner(secret, nodeID string) (*Signer, error) {
	if secret == "" {
		return nil, ErrEmptySecret
	}
	key := []byte(secret)
	s := &Signer{secret: key, nodeID: nodeID}
	s.macPool.New = func() any {
		return hmac.New(sha256.New, key)
	}
	return s, nil
}

// sigBuf is pooled scratch space for canonical string assembly and hex encoding.
// Fixed-size arrays avoid heap allocs on the signing hot path.
type sigBuf struct {
	canonical []byte
	hexSig    [64]byte // SHA-256 HMAC → 32 bytes → 64 hex chars
	hexHash   [64]byte // SHA-256 body hash → 64 hex chars
	tsBuf     [20]byte // enough for int64 unix timestamp
}

var sigBufPool = sync.Pool{
	New: func() any { return &sigBuf{canonical: make([]byte, 0, 256)} },
}

// Sign adds HMAC signature headers to a request.
//
// Canonical string matches the control-plane verifier:
//
//	METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
func (s *Signer) Sign(req *http.Request, body []byte) {
	buf := sigBufPool.Get().(*sigBuf)
	// Pool the HMAC — hmac.New allocates ~10 objects internally; Reset()
	// restores to the keyed initial state without re-deriving ipad/opad.
	mac := s.macPool.Get().(hash.Hash)
	mac.Reset()

	ts := strconv.AppendInt(buf.tsBuf[:0], time.Now().Unix(), 10)

	bodyHash := sha256.Sum256(body)
	hex.Encode(buf.hexHash[:], bodyHash[:])

	// Assemble canonical string: METHOD\nPATH\nTS\nBODYHASH
	buf.canonical = buf.canonical[:0]
	buf.canonical = append(buf.canonical, req.Method...)
	buf.canonical = append(buf.canonical, '\n')
	buf.canonical = append(buf.canonical, req.URL.Path...)
	buf.canonical = append(buf.canonical, '\n')
	buf.canonical = append(buf.canonical, ts...)
	buf.canonical = append(buf.canonical, '\n')
	buf.canonical = append(buf.canonical, buf.hexHash[:]...)

	mac.Write(buf.canonical)
	// Sum appends the 32-byte digest to buf.canonical's backing array (which we
	// no longer need) — avoids a separate alloc for the digest output.
	sum := mac.Sum(buf.canonical[:0])
	hex.Encode(buf.hexSig[:], sum[len(sum)-sha256.Size:])

	req.Header.Set("X-LangWatch-Gateway-Timestamp", string(ts))
	req.Header.Set("X-LangWatch-Gateway-Signature", string(buf.hexSig[:]))
	if s.nodeID != "" {
		req.Header.Set("X-LangWatch-Gateway-Node", s.nodeID)
	}

	s.macPool.Put(mac)
	sigBufPool.Put(buf)
}
