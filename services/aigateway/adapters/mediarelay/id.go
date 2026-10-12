// Package mediarelay joins a worker's relay socket to Twilio's media stream
// through the gateway, so a phone run needs no tunnel and no inbound port on
// the worker. The worker opens a relay and is told an id; Twilio dials the
// gateway with that id; the gateway moves frames between the two verbatim.
package mediarelay

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// IDVersion is the format version sealed into every relay id.
const IDVersion = 1

const (
	idKeyInfo = "voice-media-relay-id/v1"
	// maxIDLength rejects absurd input before any decoding.
	maxIDLength = 256
)

var (
	// ErrIDInvalid means the id is malformed, forged, or sealed with another key.
	ErrIDInvalid = errors.New("mediarelay: relay id is invalid")
	// ErrIDExpired means the id is genuine and past its expiry.
	ErrIDExpired = errors.New("mediarelay: relay id has expired")

	errNoSecret = errors.New("mediarelay: relay id codec has no secret")
)

// IDClaims is what a relay id carries.
type IDClaims struct {
	Version int
	// OwnerPodIP is the pod holding the relay; empty on a single-pod gateway.
	OwnerPodIP  string
	OwnerBootID string
	// Random is the 128 bits that make the id unguessable and name the relay.
	// Seal draws it when the caller leaves it zero.
	Random    [16]byte
	ExpiresAt time.Time
}

// IDCodec seals and opens relay ids. The id is the only credential on the
// Twilio leg, so it is encrypted: nobody outside can forge it or read the
// owner address in it.
type IDCodec struct {
	aead cipher.AEAD
}

// NewIDCodec derives the id key from secret. An empty secret gives a codec
// whose Seal and Unseal both fail.
func NewIDCodec(secret string) *IDCodec {
	if secret == "" {
		return &IDCodec{}
	}
	key, err := hkdf.Key(sha256.New, []byte(secret), nil, idKeyInfo, 32)
	if err != nil {
		return &IDCodec{}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return &IDCodec{}
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return &IDCodec{}
	}
	return &IDCodec{aead: aead}
}

// Seal encodes the claims as a base64url id. Two seals of the same claims
// differ, because the nonce is fresh.
func (c *IDCodec) Seal(claims IDClaims) (string, error) {
	if c.aead == nil {
		return "", errNoSecret
	}
	if len(claims.OwnerPodIP) > 255 || len(claims.OwnerBootID) > 255 {
		return "", fmt.Errorf("mediarelay: relay id owner is too long")
	}
	if claims.Random == [16]byte{} {
		if _, err := rand.Read(claims.Random[:]); err != nil {
			return "", fmt.Errorf("mediarelay: draw relay id: %w", err)
		}
	}
	plain := []byte{IDVersion, byte(len(claims.OwnerPodIP))}
	plain = append(plain, claims.OwnerPodIP...)
	plain = append(plain, byte(len(claims.OwnerBootID)))
	plain = append(plain, claims.OwnerBootID...)
	plain = append(plain, claims.Random[:]...)
	plain = binary.BigEndian.AppendUint64(plain, uint64(claims.ExpiresAt.Unix()))

	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("mediarelay: draw relay id nonce: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(c.aead.Seal(nonce, nonce, plain, nil)), nil
}

// Unseal opens an id. It answers ErrIDInvalid for anything not sealed by this
// key, and ErrIDExpired for a genuine id at or past its expiry, to the second.
func (c *IDCodec) Unseal(id string, now time.Time) (IDClaims, error) {
	if c.aead == nil {
		return IDClaims{}, errNoSecret
	}
	if id == "" || len(id) > maxIDLength {
		return IDClaims{}, ErrIDInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil || len(raw) <= c.aead.NonceSize() {
		return IDClaims{}, ErrIDInvalid
	}
	plain, err := c.aead.Open(nil, raw[:c.aead.NonceSize()], raw[c.aead.NonceSize():], nil)
	if err != nil {
		return IDClaims{}, ErrIDInvalid
	}
	claims, ok := parseClaims(plain)
	if !ok {
		return IDClaims{}, ErrIDInvalid
	}
	if now.Unix() >= claims.ExpiresAt.Unix() {
		return claims, ErrIDExpired
	}
	return claims, nil
}

// claimReader consumes the plaintext layout front to back.
type claimReader struct{ rest []byte }

func (r *claimReader) take(n int) ([]byte, bool) {
	if len(r.rest) < n {
		return nil, false
	}
	head := r.rest[:n]
	r.rest = r.rest[n:]
	return head, true
}

// takeString reads a one-byte length followed by that many bytes.
func (r *claimReader) takeString() (string, bool) {
	length, ok := r.take(1)
	if !ok {
		return "", false
	}
	value, ok := r.take(int(length[0]))
	return string(value), ok
}

// parseClaims reads the plaintext layout Seal writes.
func parseClaims(plain []byte) (IDClaims, bool) {
	var claims IDClaims
	r := &claimReader{rest: plain}
	version, ok := r.take(1)
	if !ok || version[0] != IDVersion {
		return claims, false
	}
	claims.Version = int(version[0])
	for _, field := range []*string{&claims.OwnerPodIP, &claims.OwnerBootID} {
		if *field, ok = r.takeString(); !ok {
			return claims, false
		}
	}
	random, ok := r.take(len(claims.Random))
	if !ok {
		return claims, false
	}
	copy(claims.Random[:], random)
	expiry, ok := r.take(8)
	if !ok || len(r.rest) != 0 {
		return claims, false
	}
	claims.ExpiresAt = time.Unix(int64(binary.BigEndian.Uint64(expiry)), 0)
	return claims, true
}
