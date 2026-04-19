package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Resolver calls the LangWatch control plane to turn a raw virtual key
// bearer token into a signed JWT + config bundle. Implementations are
// expected to retry transient upstream failures; callers should not retry.
type Resolver interface {
	ResolveKey(ctx context.Context, rawKey string) (*Bundle, error)
	FetchConfig(ctx context.Context, vkID string, currentRevision int64) (*Config, bool, error)
	// WaitForChanges long-polls the control-plane /changes endpoint
	// scoped to a single organization. The contract (§4.3) requires
	// organization_id explicit on the query so the control plane can
	// filter ChangeEvent rows by index without decoding the signer's
	// JWT. An empty orgID is valid during bootstrap (no VK has
	// resolved yet); the resolver sends the request anyway and the
	// control plane short-circuits with 204 No Content.
	WaitForChanges(ctx context.Context, orgID string, sinceRevision int64, timeout time.Duration) ([]ChangeEvent, error)
	VerifyJWT(token string) (*JWTClaims, error)
}

// RequestSigner is an optional capability exposed by the default
// http-based Resolver so other packages (budget outbox, guardrail client)
// can sign their own outbound calls with the shared HMAC scheme without
// re-implementing it.
type RequestSigner interface {
	SignRequest(req *http.Request, body []byte)
}

// SignRequest is the public form of signRequest so other packages can
// delegate signing. Implemented on *httpResolver.
func (r *httpResolver) SignRequest(req *http.Request, body []byte) {
	r.signRequest(req, body)
}

// ChangeEvent is emitted by the long-poll /changes endpoint when any VK or
// budget mutation lands. Revision is BigInt-as-string on the wire.
type ChangeEvent struct {
	VirtualKeyID string   `json:"vk_id"`
	NewRevision  BigInt64 `json:"revision"`
	Kind         string   `json:"kind"` // vk_updated|budget_updated|vk_revoked|config_updated
}

type httpResolver struct {
	baseURL        string
	internalSecret []byte
	jwtSecret      []byte
	jwtSecretPrev  []byte // optional; set during a key rotation window
	gatewayNodeID  string
	// http is the short-RPC client used for resolve-key + fetch-config.
	// Timeout is opts.Timeout (typically 2s). The long-poll path uses
	// longPollHTTP with a much larger deadline so the changes endpoint
	// (up to 25s server-held) can actually complete.
	http         *http.Client
	longPollHTTP *http.Client
	jwtKeyFn     jwt.Keyfunc
}

// HTTPResolverOptions carries everything NewHTTPResolver needs. Named
// options keep the constructor readable as more knobs appear.
type HTTPResolverOptions struct {
	BaseURL        string        // control-plane base URL (e.g. http://langwatch:5560)
	InternalSecret string        // HMAC secret for signing internal calls (LW_GATEWAY_INTERNAL_SECRET)
	JWTSecret      string        // HMAC secret for verifying JWTs signed by the control plane (LW_GATEWAY_JWT_SECRET)
	// JWTSecretPrevious is the pre-rotation secret. When both JWTSecret
	// and JWTSecretPrevious are set, the resolver accepts tokens signed
	// with either — required for zero-downtime JWT secret rotation,
	// because:
	//   1. Operator flips control plane to new signing secret.
	//   2. Gateways bounce in rolling order, each picking up the new
	//      current + old-as-previous.
	//   3. JWTs issued before the flip (TTL up to 15m) still verify.
	//   4. After all bundles expire, operator removes the previous
	//      secret and gateways rotate it out on next bounce.
	// Empty string disables the fallback (strict single-key mode).
	JWTSecretPrevious string
	GatewayNodeID     string        // identifier for this gateway node (hostname is a fine default)
	Timeout           time.Duration // per-request timeout for non-long-poll calls
	// LongPollTimeout is the ceiling for WaitForChanges' http.Client.
	// Must be strictly greater than the timeout we send on the wire as
	// the `timeout_s` query param or the client races the server-held
	// long-poll and fires "context deadline exceeded (Client.Timeout
	// exceeded while awaiting headers)" just before Hono's 204 lands.
	// Zero disables the override and falls back to Timeout (unsafe for
	// long-poll — expect immediate timeouts). Default 30s is 5s over
	// the 25s we send on the wire.
	LongPollTimeout time.Duration
}

// NewHTTPResolver returns a Resolver that talks to the LangWatch control
// plane over HTTP with HMAC-signed internal calls. The JWT secret verifies
// the short-lived bundles issued by /resolve-key; the internal secret signs
// every gateway→control-plane request per contract §4.0.
func NewHTTPResolver(opts HTTPResolverOptions) Resolver {
	jwtSecret := []byte(opts.JWTSecret)
	jwtPrev := []byte(opts.JWTSecretPrevious)
	longPollTimeout := opts.LongPollTimeout
	if longPollTimeout <= 0 {
		longPollTimeout = opts.Timeout
	}
	r := &httpResolver{
		baseURL:        strings.TrimRight(opts.BaseURL, "/"),
		internalSecret: []byte(opts.InternalSecret),
		jwtSecret:      jwtSecret,
		jwtSecretPrev:  jwtPrev,
		gatewayNodeID:  opts.GatewayNodeID,
		http:           &http.Client{Timeout: opts.Timeout},
		longPollHTTP:   &http.Client{Timeout: longPollTimeout},
	}
	r.jwtKeyFn = func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected jwt signing method: %v", t.Header["alg"])
		}
		// golang-jwt v5 natively loops a VerificationKeySet: the
		// first key that verifies wins. Order doesn't affect
		// correctness, but putting the current secret first is the
		// common-case fast path.
		if len(r.jwtSecretPrev) > 0 {
			return jwt.VerificationKeySet{
				Keys: []jwt.VerificationKey{jwtSecret, jwtPrev},
			}, nil
		}
		return jwtSecret, nil
	}
	return r
}

// Request/response shapes match specs/ai-gateway/_shared/contract.md §4.
type resolveReq struct {
	KeyPresented  string `json:"key_presented"`
	GatewayNodeID string `json:"gateway_node_id"`
}

// resolveResp mirrors the /api/internal/gateway/resolve-key response.
// Revision is emitted as a JSON string by the control plane (BigInt
// serialization survives JSON), so accept it as a string here and
// parse to int64 below. Earlier iters typed this as int64 which
// caused silent `json: cannot unmarshal string into int64` errors
// that surfaced as 503 auth_upstream_unavailable (finding #15).
type resolveResp struct {
	JWT           string `json:"jwt"`
	Revision      string `json:"revision"`
	KeyID         string `json:"key_id"`
	DisplayPrefix string `json:"display_prefix"`
}

func (r *httpResolver) ResolveKey(ctx context.Context, rawKey string) (*Bundle, error) {
	body, _ := json.Marshal(resolveReq{
		KeyPresented:  rawKey,
		GatewayNodeID: r.gatewayNodeID,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", r.baseURL+"/api/internal/gateway/resolve-key", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	r.signRequest(req, body)
	resp, err := r.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("resolve-key transport: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrInvalidKey
	}
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusGone {
		return nil, ErrKeyRevoked
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("resolve-key upstream %d: %s", resp.StatusCode, string(b))
	}
	var rr resolveResp
	if err := json.NewDecoder(resp.Body).Decode(&rr); err != nil {
		return nil, fmt.Errorf("resolve-key decode: %w", err)
	}
	claims, err := r.VerifyJWT(rr.JWT)
	if err != nil {
		return nil, fmt.Errorf("resolve-key jwt verify: %w", err)
	}
	// Reconcile resolve-key's top-level revision into claims.Revision
	// (also BigInt-as-string on the wire). Prefer the explicit field
	// over the JWT claim if both are set and disagree — the claim is
	// stamped at JWT-sign-time; the top-level is the latest read from
	// VirtualKey.revision, so it's the canonical fresh value.
	if rr.Revision != "" {
		if parsed, perr := strconv.ParseInt(rr.Revision, 10, 64); perr == nil {
			claims.Revision = parsed
		}
	}
	return &Bundle{
		JWT:           rr.JWT,
		JWTClaims:     *claims,
		Config:        nil, // fetched separately via /config/:vk_id
		JWTExpiresAt:  time.Unix(claims.ExpiresAt, 0),
		ResolvedAt:    time.Now(),
		DisplayPrefix: rr.DisplayPrefix,
	}, nil
}

func (r *httpResolver) FetchConfig(ctx context.Context, vkID string, currentRevision int64) (*Config, bool, error) {
	url := r.baseURL + "/api/internal/gateway/config/" + vkID
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, false, err
	}
	if currentRevision > 0 {
		req.Header.Set("If-None-Match", fmt.Sprintf(`"%d"`, currentRevision))
	}
	r.signRequest(req, nil)
	resp, err := r.http.Do(req)
	if err != nil {
		return nil, false, fmt.Errorf("fetch-config transport: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		return nil, false, nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, false, fmt.Errorf("fetch-config upstream %d: %s", resp.StatusCode, string(b))
	}
	var cfg Config
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, false, fmt.Errorf("fetch-config decode: %w", err)
	}
	cfg.FetchedAt = time.Now()
	return &cfg, true, nil
}

func (r *httpResolver) WaitForChanges(ctx context.Context, orgID string, sinceRevision int64, timeout time.Duration) ([]ChangeEvent, error) {
	url := fmt.Sprintf("%s/api/internal/gateway/changes?organization_id=%s&since=%d&timeout_s=%d",
		r.baseURL, orgID, sinceRevision, int(timeout.Seconds()))
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	r.signRequest(req, nil)
	resp, err := r.longPollHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("changes transport: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("changes upstream %d: %s", resp.StatusCode, string(b))
	}
	// Contract §4.3 response shape: {current_revision, changes: [...]}.
	// current_revision is BigInt-as-string on the wire (Prisma BigInt
	// column); BigInt64 tolerates either number or quoted string.
	var wrap struct {
		CurrentRevision BigInt64      `json:"current_revision"`
		Changes         []ChangeEvent `json:"changes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrap); err != nil {
		return nil, fmt.Errorf("changes decode: %w", err)
	}
	return wrap.Changes, nil
}

// signRequest stamps an HMAC-SHA256 signature + timestamp over the
// canonical request string:
//
//	METHOD + '\n' + PATH + '\n' + TIMESTAMP + '\n' + hex(sha256(body))
//
// The same construction is verified on the control-plane side (Alexis's
// Hono middleware). Timestamp is unix seconds; server rejects if
// |now - ts| > 300s to prevent replay of captured intra-cluster calls.
// See contract §4.0.
func (r *httpResolver) signRequest(req *http.Request, bodyForHash []byte) {
	r.signRequestAt(req, bodyForHash, time.Now().Unix())
}

// signRequestAt is the testable form — timestamp injected by the caller so
// unit tests can assert exact signature bytes.
func (r *httpResolver) signRequestAt(req *http.Request, bodyForHash []byte, unixTS int64) {
	if r.gatewayNodeID != "" {
		req.Header.Set("X-LangWatch-Gateway-Node", r.gatewayNodeID)
	}
	if len(r.internalSecret) == 0 {
		return // dev mode; control-plane should reject if GATEWAY_ALLOW_INSECURE is also off server-side
	}
	ts := strconv.FormatInt(unixTS, 10)
	bodyHash := sha256.Sum256(bodyForHash)
	canonical := req.Method + "\n" + req.URL.Path + "\n" + ts + "\n" + hex.EncodeToString(bodyHash[:])
	mac := hmac.New(sha256.New, r.internalSecret)
	mac.Write([]byte(canonical))
	sig := hex.EncodeToString(mac.Sum(nil))
	req.Header.Set("X-LangWatch-Gateway-Signature", sig)
	req.Header.Set("X-LangWatch-Gateway-Timestamp", ts)
}

func (r *httpResolver) VerifyJWT(token string) (*JWTClaims, error) {
	claims := &JWTClaims{}
	t, err := jwt.ParseWithClaims(token, claims, r.jwtKeyFn)
	if err != nil {
		return nil, fmt.Errorf("jwt parse: %w", err)
	}
	if !t.Valid {
		return nil, errors.New("jwt invalid")
	}
	if claims.ExpiresAt > 0 && time.Now().After(time.Unix(claims.ExpiresAt, 0)) {
		return nil, errors.New("jwt expired")
	}
	if claims.VirtualKeyID == "" || claims.ProjectID == "" {
		return nil, errors.New("jwt missing required claims")
	}
	return claims, nil
}

var (
	ErrInvalidKey = errors.New("invalid api key")
	ErrKeyRevoked = errors.New("virtual key revoked")
)

// Claims implements jwt.Claims so golang-jwt can parse into JWTClaims.
func (c *JWTClaims) GetExpirationTime() (*jwt.NumericDate, error) {
	if c.ExpiresAt == 0 {
		return nil, nil
	}
	return jwt.NewNumericDate(time.Unix(c.ExpiresAt, 0)), nil
}
func (c *JWTClaims) GetIssuedAt() (*jwt.NumericDate, error) {
	if c.IssuedAt == 0 {
		return nil, nil
	}
	return jwt.NewNumericDate(time.Unix(c.IssuedAt, 0)), nil
}
func (c *JWTClaims) GetNotBefore() (*jwt.NumericDate, error) { return nil, nil }
func (c *JWTClaims) GetIssuer() (string, error)              { return c.Issuer, nil }
func (c *JWTClaims) GetSubject() (string, error) {
	if c.Subject != "" {
		return c.Subject, nil
	}
	return c.VirtualKeyID, nil
}
func (c *JWTClaims) GetAudience() (jwt.ClaimStrings, error) {
	if c.Audience == "" {
		return nil, nil
	}
	return jwt.ClaimStrings{c.Audience}, nil
}
