// Package controlplane provides the unified HTTP client for all control plane RPCs.
package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/jwtverify"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ClientOptions configures the control plane client.
type ClientOptions struct {
	BaseURL           string
	Sign              func(req *http.Request, body []byte)
	Verifier          *jwtverify.JWTVerifier
	HTTPClient        *http.Client
	Logger            *zap.Logger
	GuardrailTimeouts GuardrailTimeouts
	// UserAgent is the value sent in the User-Agent header on every outbound
	// request to the control plane. Typically "langwatch-aigateway/<version>".
	UserAgent string
}

// GuardrailTimeouts configures per-direction budgets for guardrail evaluation.
type GuardrailTimeouts struct {
	Pre         time.Duration
	Post        time.Duration
	StreamChunk time.Duration
}

// Client calls the LangWatch control plane for key resolution, config fetching,
// guardrail evaluation, and budget debit.
type Client struct {
	baseURL           string
	userAgent         string
	sign              func(req *http.Request, body []byte)
	verifier          *jwtverify.JWTVerifier
	client            *http.Client
	pollClient        *http.Client
	logger            *zap.Logger
	guardrailTimeouts GuardrailTimeouts
}

// NewClient creates a control plane client with the given options.
func NewClient(opts ClientOptions) *Client {
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 100,
				IdleConnTimeout:     90 * time.Second,
				ForceAttemptHTTP2:   true,
			},
		}
	}
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	if opts.GuardrailTimeouts.Pre == 0 {
		opts.GuardrailTimeouts.Pre = 5 * time.Second
	}
	if opts.GuardrailTimeouts.Post == 0 {
		opts.GuardrailTimeouts.Post = 5 * time.Second
	}
	if opts.GuardrailTimeouts.StreamChunk == 0 {
		opts.GuardrailTimeouts.StreamChunk = 50 * time.Millisecond
	}
	// pollClient is the long-poll-friendly variant: same Transport pool
	// (no extra TCP/TLS overhead) but with no overall Timeout. The
	// /changes endpoint holds the connection for up to ~10s server-side;
	// using the shared client (Timeout=10s) was racing the server's
	// 204 response and dropping events. Cancellation flows through
	// context.Done so shutdown still works.
	pollClient := &http.Client{
		Transport: opts.HTTPClient.Transport,
		Jar:       opts.HTTPClient.Jar,
		// Timeout intentionally unset — the per-request context is the
		// binding deadline.
	}
	return &Client{
		baseURL:           opts.BaseURL,
		userAgent:         opts.UserAgent,
		sign:              opts.Sign,
		verifier:          opts.Verifier,
		client:            opts.HTTPClient,
		pollClient:        pollClient,
		logger:            opts.Logger,
		guardrailTimeouts: opts.GuardrailTimeouts,
	}
}

// ResolveKey exchanges a raw virtual key for a domain.Bundle.
func (c *Client) ResolveKey(ctx context.Context, rawKey string) (*domain.Bundle, error) {
	payload, _ := json.Marshal(map[string]string{"key_presented": rawKey})
	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/resolve-key")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrAuthUpstream, nil, err)
	}
	req.Header.Set("Content-Type", "application/json")
	c.setCommonHeaders(req)
	c.sign(req, payload)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrAuthUpstream, nil, err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusUnauthorized:
		return nil, herr.New(ctx, domain.ErrInvalidAPIKey, nil)
	case resp.StatusCode == http.StatusForbidden:
		// The control plane distinguishes the reversible disable and the
		// self-serve expiry from the one-way revoke in its error code;
		// forward the distinction so neither tenant is told its credential
		// is gone for good. The decoded code decides it, never a substring
		// of the body: the human-readable message travels in the same
		// payload and may name a code this is not. An unrecognized or
		// undecodable 403 still reads as revoked, which is the safe answer
		// for a gateway older than the code.
		var rejection struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(respBody, &rejection)
		switch rejection.Error.Code {
		case "virtual_key_disabled":
			return nil, herr.New(ctx, domain.ErrKeyDisabled, herr.M{
				"message": "This key is disabled. An administrator can re-enable it; the key material is unchanged.",
			})
		case "virtual_key_expired":
			return nil, herr.New(ctx, domain.ErrKeyExpired, herr.M{
				"message": "This key has expired. Extend its expiration date, or create a new key.",
			})
		}
		return nil, herr.New(ctx, domain.ErrKeyRevoked, nil)
	case resp.StatusCode != http.StatusOK:
		return nil, herr.New(ctx, domain.ErrAuthUpstream, nil, fmt.Errorf("control plane returned %d", resp.StatusCode))
	}

	var result struct {
		Token string `json:"jwt"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, herr.New(ctx, domain.ErrAuthUpstream, nil, err)
	}

	mapClaims, err := c.verifier.Verify(result.Token)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrAuthUpstream, nil, err)
	}

	return claimsToBundle(extractClaims(mapClaims)), nil
}

// Change is one mutation observed by the control plane that the gateway
// must react to (cache invalidation, in practice). Mirrors the wire shape
// emitted by GET /api/internal/gateway/changes. Kind crosses this boundary
// as an opaque string; the set the gateway acts on is enumerated by the
// ChangeKind constants in the authresolver package, which is where the
// switch over it lives.
type Change struct {
	Kind            string
	VirtualKeyID    string
	BudgetID        string
	ModelProviderID string
	ProjectID       string
	Revision        string
}

// PollChanges does one /changes long-poll. Returns the events the control
// plane buffered since `since`, the org's current revision (advance the
// caller's cursor to this on the next poll), and any error.
//
// Wire contract:
//   - 200 with {current_revision, changes: [...]} → at least one event
//   - 204 with X-LangWatch-Revision header → no events within timeout
//   - any other status → transport-class error (caller should backoff)
//
// Long-poll timeout on the server is ~10s (gateway-internal.ts:407). We
// give the HTTP client 25s so the server's deadline is the binding signal.
func (c *Client) PollChanges(ctx context.Context, organizationID, since string) ([]Change, string, error) {
	if organizationID == "" {
		return nil, since, fmt.Errorf("PollChanges: organizationID is required")
	}
	// Per-request deadline: server long-poll holds for up to ~10s
	// (gateway-internal.ts: timeoutSeconds capped at 25, default 10).
	// Give the client a 5s buffer so the server's 204 lands cleanly
	// before our ctx fires. Without this buffer, a transient race
	// dropped almost every long-poll on transport-deadline errors.
	pollCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/changes")
	req, err := http.NewRequestWithContext(pollCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, since, err
	}
	q := req.URL.Query()
	q.Set("organization_id", organizationID)
	if since == "" {
		q.Set("since", "0")
	} else {
		q.Set("since", since)
	}
	q.Set("timeout_s", "10")
	req.URL.RawQuery = q.Encode()
	c.setCommonHeaders(req)
	c.sign(req, nil)

	resp, err := c.pollClient.Do(req)
	if err != nil {
		return nil, since, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNoContent {
		// 204 — no events within the long-poll window. Server-supplied
		// revision header lets us advance the cursor without spinning.
		if rev := resp.Header.Get("X-LangWatch-Revision"); rev != "" {
			return nil, rev, nil
		}
		return nil, since, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, since, fmt.Errorf("changes poll returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, since, err
	}
	var wire struct {
		CurrentRevision string `json:"current_revision"`
		Changes         []struct {
			Kind            string `json:"kind"`
			VirtualKeyID    string `json:"virtual_key_id"`
			BudgetID        string `json:"budget_id"`
			ModelProviderID string `json:"model_provider_id"`
			ProjectID       string `json:"project_id"`
			Revision        string `json:"revision"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, since, err
	}
	out := make([]Change, len(wire.Changes))
	for i, ch := range wire.Changes {
		out[i] = Change{
			Kind:            ch.Kind,
			VirtualKeyID:    ch.VirtualKeyID,
			BudgetID:        ch.BudgetID,
			ModelProviderID: ch.ModelProviderID,
			ProjectID:       ch.ProjectID,
			Revision:        ch.Revision,
		}
	}
	return out, wire.CurrentRevision, nil
}

// FetchConfig retrieves the VK's full config from the control plane.
//
// Conditional when ifNoneMatch is non-empty: the ETag goes back as
// If-None-Match and a 304 is reported as NotModified rather than a config.
// The control plane keys that ETag off the virtual key's revision, which every
// mutation bumps (contract §4.2), so revalidating a key nobody touched costs a
// revision lookup instead of materializing the whole bundle again. An empty
// ifNoneMatch asks for the config outright.
//
// Anything other than a well-formed 200 or a 304 answering our own
// If-None-Match is an error: a caller must never take a surprising response
// as permission to keep serving config it cannot vouch for.
func (c *Client) FetchConfig(ctx context.Context, vkID, ifNoneMatch string) (domain.ConfigFetchResult, error) {
	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/config", url.PathEscape(vkID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return domain.ConfigFetchResult{}, err
	}
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	c.setCommonHeaders(req)
	c.sign(req, nil)

	resp, err := c.client.Do(req)
	if err != nil {
		return domain.ConfigFetchResult{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, readErr := io.ReadAll(resp.Body)

	// A 304 can only answer a conditional request, so it can only mean the
	// ETag we sent is still current. The result carries that same ETag back:
	// a body-less response is no basis for adopting a different one, which
	// would pin the caller to config it never fetched.
	if ifNoneMatch != "" && resp.StatusCode == http.StatusNotModified {
		return domain.ConfigFetchResult{ETag: ifNoneMatch, NotModified: true}, nil
	}
	if resp.StatusCode != http.StatusOK {
		return domain.ConfigFetchResult{}, fmt.Errorf("config fetch returned %d", resp.StatusCode)
	}
	// A read that ended in an error leaves the response's integrity unknown,
	// and the bytes that did arrive parsing is not evidence to the contrary:
	// a prefix can be a complete JSON object while the message it was cut out
	// of never arrived whole. Config is only worth caching when the whole
	// answer was seen, the more so because accepting it stamps the server's
	// ETag on it, and every later refresh then revalidates against a token
	// vouching for a response this node never fully read.
	if readErr != nil {
		return domain.ConfigFetchResult{}, fmt.Errorf("config fetch body: %w", readErr)
	}

	var wire configWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return domain.ConfigFetchResult{}, err
	}
	// A response with no ETag header stores none, so the next fetch goes out
	// unconditional and gets the config outright.
	return domain.ConfigFetchResult{Config: wire.toDomain(), ETag: resp.Header.Get("ETag")}, nil
}

// BudgetBucketSpend reads the current-period spend for one attributed-user
// bucket: the enforcement figure behind per-end-user templates. Cached by
// the caller (adapters/budget.CachedBucketSpend); this is the cold path.
func (c *Client) BudgetBucketSpend(ctx context.Context, budgetID, endUserID string) (int64, error) {
	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/budget-bucket-spend")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	q := req.URL.Query()
	q.Set("budget_id", budgetID)
	q.Set("end_user_id", endUserID)
	req.URL.RawQuery = q.Encode()
	c.setCommonHeaders(req)
	c.sign(req, nil)

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("budget bucket spend returned %d", resp.StatusCode)
	}
	var wire struct {
		SpentMicroUSD int64 `json:"spent_micro_usd"`
	}
	if err := json.Unmarshal(body, &wire); err != nil {
		return 0, err
	}
	return wire.SpentMicroUSD, nil
}

// Health performs the signed control-plane connectivity probe backing the
// gateway's public /health status endpoint (adapters/statusprobe). It hits
// the HMAC-protected /api/internal/gateway/health route rather than a
// public liveness path on purpose: a success proves the whole channel the
// gateway depends on to serve traffic: DNS, TCP/TLS, the app being up,
// AND the shared internal secret matching. A wrong secret is the exact
// misconfig where every pod looks green while every virtual-key resolve
// is refused, and this is the only probe that catches it.
func (c *Client) Health(ctx context.Context) error {
	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/health")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	c.setCommonHeaders(req)
	c.sign(req, nil)

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	// Drain the small body so the pooled connection is reusable.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("control plane health returned %d", resp.StatusCode)
	}
	return nil
}

// --- Internal helpers ---

// Claims are the gateway-relevant fields extracted from a control-plane JWT.
type Claims struct {
	VirtualKeyID   string
	ProjectID      string
	TeamID         string
	OrganizationID string
	ExpiresAt      int64
}

func extractClaims(m map[string]any) *Claims {
	c := &Claims{}
	if v, ok := m["vk_id"].(string); ok {
		c.VirtualKeyID = v
	}
	if v, ok := m["project_id"].(string); ok {
		c.ProjectID = v
	}
	if v, ok := m["team_id"].(string); ok {
		c.TeamID = v
	}
	if v, ok := m["org_id"].(string); ok {
		c.OrganizationID = v
	}
	if v, ok := m["exp"].(float64); ok {
		c.ExpiresAt = int64(v)
	}
	return c
}

func claimsToBundle(c *Claims) *domain.Bundle {
	return &domain.Bundle{
		VirtualKeyID:   c.VirtualKeyID,
		ProjectID:      c.ProjectID,
		TeamID:         c.TeamID,
		OrganizationID: c.OrganizationID,
		ExpiresAt:      time.Unix(c.ExpiresAt, 0),
	}
}

// setCommonHeaders stamps headers shared by every outbound control-plane request.
func (c *Client) setCommonHeaders(req *http.Request) {
	if c.userAgent != "" {
		req.Header.Set("User-Agent", c.userAgent)
	}
}

// RefreshCodexToken asks the control plane — the codex OAuth session's owner —
// to refresh the provider row's stored tokens and hand back a fresh access
// token. Implements domain.CodexTokenRefresher; a dead session (the control
// plane answers 401 codex_session_expired) wraps domain.ErrCodexSessionDead
// so the dispatcher stops retrying and surfaces the sign-in-again error.
func (c *Client) RefreshCodexToken(ctx context.Context, providerRowID string) (string, string, error) {
	payload, err := json.Marshal(map[string]string{"provider_row_id": providerRowID})
	if err != nil {
		return "", "", err
	}
	resp, err := c.signedPost(ctx, "/api/internal/gateway/codex/refresh", payload)
	if err != nil {
		return "", "", fmt.Errorf("codex refresh call: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", "", fmt.Errorf("codex refresh read: %w", err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		// herr carries the typed code for surfacing; ErrCodexSessionDead rides
		// as a reason so the dispatcher's errors.Is sentinel check still fires.
		return "", "", herr.New(ctx, domain.ErrCodexSessionExpired, nil, domain.ErrCodexSessionDead)
	}
	if resp.StatusCode != http.StatusOK {
		snippet := body
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return "", "", herr.New(ctx, domain.ErrAuthUpstream, herr.M{
			"reason":      "codex refresh failed",
			"http_status": resp.StatusCode,
			"body":        string(snippet),
		})
	}
	var parsed struct {
		AccessToken string `json:"access_token"`
		AccountID   string `json:"account_id"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || parsed.AccessToken == "" {
		return "", "", herr.New(ctx, domain.ErrAuthUpstream, herr.M{
			"reason": "codex refresh: malformed response",
		})
	}
	return parsed.AccessToken, parsed.AccountID, nil
}

// signedPost is a helper for POST requests to the control plane.
func (c *Client) signedPost(ctx context.Context, path string, body []byte) (*http.Response, error) {
	endpoint, _ := url.JoinPath(c.baseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.setCommonHeaders(req)
	c.sign(req, body)
	return c.client.Do(req)
}
