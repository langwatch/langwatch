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
	sign              func(req *http.Request, body []byte)
	verifier          *jwtverify.JWTVerifier
	client            *http.Client
	logger            *zap.Logger
	guardrailTimeouts GuardrailTimeouts
}

// NewClient creates a control plane client with the given options.
func NewClient(opts ClientOptions) *Client {
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{Timeout: 10 * time.Second}
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
	return &Client{
		baseURL:           opts.BaseURL,
		sign:              opts.Sign,
		verifier:          opts.Verifier,
		client:            opts.HTTPClient,
		logger:            opts.Logger,
		guardrailTimeouts: opts.GuardrailTimeouts,
	}
}

// ResolveKey exchanges a raw virtual key for a domain.Bundle.
func (c *Client) ResolveKey(ctx context.Context, rawKey string) (*domain.Bundle, error) {
	payload, _ := json.Marshal(map[string]string{"key": rawKey})
	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/resolve-key")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrAuthUpstream, nil, err)
	}
	req.Header.Set("Content-Type", "application/json")
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
		Token string `json:"token"`
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

// FetchConfig retrieves the VK's full config from the control plane.
func (c *Client) FetchConfig(ctx context.Context, vkID string) (domain.BundleConfig, error) {
	endpoint, _ := url.JoinPath(c.baseURL, "/api/internal/gateway/config", url.PathEscape(vkID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return domain.BundleConfig{}, err
	}
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

	var config domain.BundleConfig
	if err := json.Unmarshal(body, &config); err != nil {
		return domain.BundleConfig{}, err
	}
	return config, nil
}

// --- Internal helpers ---

// Claims are the gateway-relevant fields extracted from a control-plane JWT.
type Claims struct {
	VirtualKeyID string
	ProjectID    string
	TeamID       string
	ExpiresAt    int64
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
	if v, ok := m["exp"].(float64); ok {
		c.ExpiresAt = int64(v)
	}
	return c
}

func claimsToBundle(c *Claims) *domain.Bundle {
	return &domain.Bundle{
		VirtualKeyID: c.VirtualKeyID,
		ProjectID:    c.ProjectID,
		TeamID:       c.TeamID,
		ExpiresAt:    time.Unix(c.ExpiresAt, 0),
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
	c.sign(req, body)
	return c.client.Do(req)
}
