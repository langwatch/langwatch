// Package frameauth is the Langy authenticated frame contract
// (LANGY_WORKER_REDESIGN_PLAN.md §0a): every frame the worker streams back to
// the control plane carries a per-frame HMAC proving BOTH who it is and that it
// really is who it says.
//
// This package SIGNS (the worker); the TS Hono relay VERIFIES. The wire contract
// is pinned cross-language by specs/langy/langy-frame-auth.vectors.json — the
// test beside this file and a TS test both reproduce those MACs, so the two
// languages can never silently diverge.
//
// Key (runToken): a 32-byte per-conversation secret minted at
// conversation_started, stored server-only, injected into the worker at spawn,
// and NEVER sent back on the wire. The HMAC proves possession without ever
// re-transmitting the secret.
//
// Construction (unambiguous by length-prefixing — an attacker cannot shift a
// byte across a field boundary to forge a colliding tuple):
//
//	signingInput = concat, over [ProjectID, UserID, ConversationID, TurnID,
//	               FrameNonce, Payload] in that fixed order, of
//	               uint32BE(len(field)) ‖ field
//	mac          = hex( HMAC-SHA256( key = hexDecode(runToken), signingInput ) )
//
// Replay is closed OUTSIDE this package (the relay checks TurnID against the
// in-flight turn and dedups FrameNonce via a shared Redis SET); this package is
// only the crypto.
package frameauth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"regexp"
)

// Identity is the stable identity every frame is bound to.
type Identity struct {
	ProjectID      string `json:"projectId"`
	UserID         string `json:"userId"`
	ConversationID string `json:"conversationId"`
	TurnID         string `json:"turnId"`
}

// Signed is the material the MAC covers: identity + this frame's nonce + its
// exact payload bytes.
type Signed struct {
	Identity
	// FrameNonce is 16 random bytes, hex — unique per frame; the relay dedups on it.
	FrameNonce string `json:"frameNonce"`
	// Payload is the exact string that is signed and transmitted verbatim; the
	// relay re-signs THESE bytes (it must not re-serialise before checking).
	Payload string `json:"payload"`
}

// Envelope is a frame on the wire: the signed material plus its hex MAC.
type Envelope struct {
	Signed
	MAC string `json:"mac"`
}

// signingInput length-prefixes each field: uint32-BE(len) ‖ bytes. The length
// prefix is what makes the field concatenation injective.
func signingInput(s Signed) []byte {
	fields := []string{s.ProjectID, s.UserID, s.ConversationID, s.TurnID, s.FrameNonce, s.Payload}
	// 4-byte length prefix per field plus the field bytes.
	total := 0
	for _, f := range fields {
		total += 4 + len(f)
	}
	buf := make([]byte, 0, total)
	var lenb [4]byte
	for _, f := range fields {
		binary.BigEndian.PutUint32(lenb[:], uint32(len(f)))
		buf = append(buf, lenb[:]...)
		buf = append(buf, f...)
	}
	return buf
}

// ComputeMAC returns the hex HMAC-SHA256 for a signed frame. runToken is the
// 32-byte secret as hex; the HMAC key is its decoded bytes.
func ComputeMAC(runToken string, s Signed) (string, error) {
	key, err := hex.DecodeString(runToken)
	if err != nil {
		return "", fmt.Errorf("frameauth: runToken is not valid hex: %w", err)
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(signingInput(s))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// Sign mints a fresh nonce and attaches the MAC. Mirrors the TS signer.
func Sign(runToken string, id Identity, payload string) (Envelope, error) {
	nonce, err := NewFrameNonce()
	if err != nil {
		return Envelope{}, err
	}
	signed := Signed{Identity: id, FrameNonce: nonce, Payload: payload}
	mac, err := ComputeMAC(runToken, signed)
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{Signed: signed, MAC: mac}, nil
}

var macPattern = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

// Verify checks a frame's MAC in constant time. Returns false — never an error
// for a mismatch — on a bad MAC, malformed MAC, or bad runToken, so a hostile
// caller learns only pass/fail. Authenticity only: TurnID-in-flight and
// FrameNonce-unseen are the relay's checks, not this function's.
func Verify(runToken string, e Envelope) bool {
	if !macPattern.MatchString(e.MAC) {
		return false
	}
	expected, err := ComputeMAC(runToken, e.Signed)
	if err != nil {
		return false
	}
	got, err := hex.DecodeString(e.MAC)
	if err != nil {
		return false
	}
	exp, err := hex.DecodeString(expected)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, exp) == 1
}

// MintRunToken returns a per-conversation runToken: 32 bytes of CSPRNG, hex (64 chars).
func MintRunToken() (string, error) {
	return randomHex(32)
}

// NewFrameNonce returns a fresh per-frame nonce: 16 bytes of CSPRNG, hex (32 chars).
func NewFrameNonce() (string, error) {
	return randomHex(16)
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("frameauth: read random: %w", err)
	}
	return hex.EncodeToString(b), nil
}
