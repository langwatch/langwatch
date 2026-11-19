package domain

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// The signed envelope an organization's bindings travel in to nlpgo
// (ADR-203). The app signs it with an Ed25519 key only it holds; nlpgo checks
// it with the public key. Holding the shared internal secret is not enough to
// name addresses to dial: tenant code on a per-project NLP Lambda can read
// that Lambda's environment, so no value an engine holds may authorize
// bindings, only a signature it can verify and cannot make.
//
// Header value: base64url(JSON envelope) "." base64url(signature), both
// without padding. The signature covers the first segment's ASCII bytes, so
// no JSON canonicalization is needed on either side.

// PrivateEndpointsProjectHeader names the project a call runs for. The app
// sets it next to PrivateEndpointsHeader; nlpgo honours an envelope only when
// it was signed for this project (and, on a workflow route, for the project
// the body names, if it names one).
const PrivateEndpointsProjectHeader = "X-LangWatch-Project-Id"

// privateEndpointsEnvelopeVersion is the only envelope version understood.
const privateEndpointsEnvelopeVersion = 1

// PrivateEndpointsEnvelope is a verified binding set and what it was signed
// for.
type PrivateEndpointsEnvelope struct {
	OrganizationID string
	ProjectID      string
	Bindings       []PrivateEndpoint
	ExpiresAt      time.Time
}

type privateEndpointsEnvelopeWire struct {
	V              int             `json:"v"`
	OrganizationID string          `json:"organizationId"`
	ProjectID      string          `json:"projectId"`
	Bindings       json.RawMessage `json:"bindings"`
	// ExpiresAt is Unix seconds.
	ExpiresAt int64 `json:"expiresAt"`
}

var (
	// ErrPrivateEndpointsSignature: the value was not signed by the key
	// this process trusts.
	ErrPrivateEndpointsSignature = errors.New("private endpoint bindings are not signed by LangWatch")
	// ErrPrivateEndpointsExpired: the envelope's expiry has passed.
	ErrPrivateEndpointsExpired = errors.New("private endpoint bindings have expired")
	// ErrPrivateEndpointsProject: the envelope was signed for another project.
	ErrPrivateEndpointsProject = errors.New("private endpoint bindings were signed for another project")
)

// ParsePrivateEndpointsVerifyKey decodes the public key from its
// configuration value: base64 (standard or URL alphabet, padding optional) of
// the 32 raw key bytes. Empty means no key is configured.
func ParsePrivateEndpointsVerifyKey(raw string) (ed25519.PublicKey, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	key, err := decodeBase64Any(raw)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("private endpoints verify key must be base64 of %d raw Ed25519 public key bytes", ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(key), nil
}

func decodeBase64Any(raw string) ([]byte, error) {
	trimmed := strings.TrimRight(raw, "=")
	if b, err := base64.RawStdEncoding.DecodeString(trimmed); err == nil {
		return b, nil
	}
	return base64.RawURLEncoding.DecodeString(trimmed)
}

// VerifyPrivateEndpointsHeader checks a signed header value and returns the
// envelope. It refuses a value that does not parse, whose signature does not
// verify under key, or that has expired at now. The caller checks the
// project. Errors never name an address.
func VerifyPrivateEndpointsHeader(value string, key ed25519.PublicKey, now time.Time) (PrivateEndpointsEnvelope, error) {
	payload, sig, found := strings.Cut(strings.TrimSpace(value), ".")
	if !found || payload == "" || sig == "" {
		return PrivateEndpointsEnvelope{}, fmt.Errorf("%w: not a signed envelope", ErrPrivateEndpointsMalformed)
	}
	signature, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return PrivateEndpointsEnvelope{}, fmt.Errorf("%w: signature is not base64url without padding", ErrPrivateEndpointsMalformed)
	}
	if len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, []byte(payload), signature) {
		return PrivateEndpointsEnvelope{}, ErrPrivateEndpointsSignature
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return PrivateEndpointsEnvelope{}, fmt.Errorf("%w: envelope is not base64url without padding", ErrPrivateEndpointsMalformed)
	}
	var wire privateEndpointsEnvelopeWire
	if err := json.Unmarshal(raw, &wire); err != nil {
		return PrivateEndpointsEnvelope{}, fmt.Errorf("%w: envelope is not JSON", ErrPrivateEndpointsMalformed)
	}
	if wire.V != privateEndpointsEnvelopeVersion {
		return PrivateEndpointsEnvelope{}, fmt.Errorf("%w: unknown envelope version %d", ErrPrivateEndpointsMalformed, wire.V)
	}
	if wire.ProjectID == "" || wire.OrganizationID == "" || wire.ExpiresAt == 0 {
		return PrivateEndpointsEnvelope{}, fmt.Errorf("%w: envelope misses its organization, project or expiry", ErrPrivateEndpointsMalformed)
	}
	expiresAt := time.Unix(wire.ExpiresAt, 0)
	if !now.Before(expiresAt) {
		return PrivateEndpointsEnvelope{}, ErrPrivateEndpointsExpired
	}
	bindings, err := ParsePrivateEndpoints(wire.Bindings)
	if err != nil {
		return PrivateEndpointsEnvelope{}, err
	}
	return PrivateEndpointsEnvelope{
		OrganizationID: wire.OrganizationID,
		ProjectID:      wire.ProjectID,
		Bindings:       bindings,
		ExpiresAt:      expiresAt,
	}, nil
}

// SignPrivateEndpointsHeader is the inverse of VerifyPrivateEndpointsHeader.
// The TS app owns the production signer; this exists for tests and tools.
func SignPrivateEndpointsHeader(env PrivateEndpointsEnvelope, key ed25519.PrivateKey) string {
	wire := make([]privateEndpointWire, 0, len(env.Bindings))
	for _, ep := range env.Bindings {
		addrs := make([]string, 0, len(ep.Addresses))
		for _, a := range ep.Addresses {
			addrs = append(addrs, a.String())
		}
		wire = append(wire, privateEndpointWire{Hostname: ep.Hostname, Addresses: addrs, Port: ep.Port})
	}
	bindings, _ := json.Marshal(wire)
	raw, _ := json.Marshal(privateEndpointsEnvelopeWire{
		V:              privateEndpointsEnvelopeVersion,
		OrganizationID: env.OrganizationID,
		ProjectID:      env.ProjectID,
		Bindings:       bindings,
		ExpiresAt:      env.ExpiresAt.Unix(),
	})
	payload := base64.RawURLEncoding.EncodeToString(raw)
	return payload + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(payload)))
}
