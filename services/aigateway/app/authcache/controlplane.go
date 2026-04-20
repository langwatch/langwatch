package authcache

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func claimsToBundle(c *Claims) *domain.Bundle {
	return &domain.Bundle{
		VirtualKeyID: c.VirtualKeyID,
		ProjectID:    c.ProjectID,
		TeamID:       c.TeamID,
		ExpiresAt:    time.Unix(c.ExpiresAt, 0),
	}
}

// ControlPlaneClient calls the LangWatch control plane for key resolution
// and config fetching.
type ControlPlaneClient struct {
	baseURL  string
	signer   *Signer
	verifier *JWTVerifier
	client   *http.Client
}

// NewControlPlaneClient creates a control plane client.
func NewControlPlaneClient(baseURL string, signer *Signer, verifier *JWTVerifier, client *http.Client) *ControlPlaneClient {
	return &ControlPlaneClient{
		baseURL:  baseURL,
		signer:   signer,
		verifier: verifier,
		client:   client,
	}
}

// ResolveKey exchanges a raw virtual key for a domain.Bundle.
func (cp *ControlPlaneClient) ResolveKey(ctx context.Context, rawKey string) (*domain.Bundle, error) {
	payload, _ := json.Marshal(map[string]string{"key": rawKey})
	req, err := http.NewRequestWithContext(ctx, "POST", cp.baseURL+"/api/internal/gateway/resolve-key", bytes.NewReader(payload))
	if err != nil {
		return nil, herr.New(ctx, ErrUpstream, nil, err)
	}
	req.Header.Set("Content-Type", "application/json")
	cp.signer.Sign(req, payload)

	resp, err := cp.client.Do(req)
	if err != nil {
		return nil, herr.New(ctx, ErrUpstream, nil, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusUnauthorized:
		return nil, herr.New(ctx, ErrInvalidKey, nil)
	case resp.StatusCode == http.StatusForbidden:
		return nil, herr.New(ctx, ErrKeyRevoked, nil)
	case resp.StatusCode != http.StatusOK:
		return nil, herr.New(ctx, ErrUpstream, herr.M{"status": resp.StatusCode})
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, herr.New(ctx, ErrUpstream, nil, err)
	}

	claims, err := cp.verifier.Verify(result.Token)
	if err != nil {
		return nil, herr.New(ctx, ErrUpstream, herr.M{"reason": "jwt_verification_failed"}, err)
	}

	return claimsToBundle(claims), nil
}

// FetchConfig retrieves the VK's full config from the control plane.
func (cp *ControlPlaneClient) FetchConfig(ctx context.Context, vkID string) (domain.BundleConfig, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", cp.baseURL+"/api/internal/gateway/config/"+vkID, nil)
	if err != nil {
		return domain.BundleConfig{}, err
	}
	cp.signer.Sign(req, nil)

	resp, err := cp.client.Do(req)
	if err != nil {
		return domain.BundleConfig{}, err
	}
	defer resp.Body.Close()
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
