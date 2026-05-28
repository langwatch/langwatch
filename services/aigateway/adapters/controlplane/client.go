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
// emitted by GET /api/internal/gateway/changes.
type Change struct {
	Kind                 string
	VirtualKeyID         string
	BudgetID             string
	ProviderCredentialID string
	ProjectID            string
	Revision             string
}

// Change kinds — keep in sync with the control-plane ChangeEventKind enum
// in langwatch/src/server/gateway/changeEvent.repository.ts.
const (
	ChangeKindProviderBindingUpdated = "PROVIDER_BINDING_UPDATED"
	ChangeKindBudgetUpdated          = "BUDGET_UPDATED"
	ChangeKindVirtualKeyUpdated      = "VIRTUAL_KEY_UPDATED"
)

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
			Kind                 string `json:"kind"`
			VirtualKeyID         string `json:"virtual_key_id"`
			BudgetID             string `json:"budget_id"`
			ProviderCredentialID string `json:"provider_credential_id"`
			ProjectID            string `json:"project_id"`
			Revision             string `json:"revision"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, since, err
	}
	out := make([]Change, len(wire.Changes))
	for i, ch := range wire.Changes {
		out[i] = Change{
			Kind:                 ch.Kind,
			VirtualKeyID:         ch.VirtualKeyID,
			BudgetID:             ch.BudgetID,
			ProviderCredentialID: ch.ProviderCredentialID,
			ProjectID:            ch.ProjectID,
			Revision:             ch.Revision,
		}
	}
	return out, wire.CurrentRevision, nil
}

// FetchConfig retrieves the VK's full config from the control plane.
func (c *Client) FetchConfig(ctx context.Context, vkID string) (domain.BundleConfig, error) {
	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/config", url.PathEscape(vkID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return domain.BundleConfig{}, err
	}
	c.setCommonHeaders(req)
	c.sign(req, nil)

	resp, err := c.client.Do(req)
	if err != nil {
		return domain.BundleConfig{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return domain.BundleConfig{}, fmt.Errorf("config fetch returned %d", resp.StatusCode)
	}

	var wire configWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return domain.BundleConfig{}, err
	}
	return wire.toDomain(), nil
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
