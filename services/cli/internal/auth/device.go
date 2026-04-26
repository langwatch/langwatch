// Package auth implements the langwatch CLI's device-code OAuth client.
//
// The flow is RFC 8628 (OAuth 2.0 Device Authorization Grant), with the
// LangWatch app's `/api/auth/cli/*` endpoints as the authorization
// server. The CLI starts a flow, prints a verification URL + user code,
// opens the browser, then polls /exchange until the user finishes the
// SSO handshake in their browser.
//
// Endpoints (snake_case JSON wire shape per Sergey's contract):
//
//	POST /api/auth/cli/device-code
//	    -> {device_code, user_code, verification_uri, expires_in, interval}
//	POST /api/auth/cli/exchange  body: {device_code}
//	    -> 200 {access_token, refresh_token, expires_in, user, organization, default_personal_vk}
//	    -> 428 Precondition Required {status: "pending"}     (keep polling)
//	    -> 410 Gone                  {status: "denied"}      (terminal)
//	    -> 408 Request Timeout       {status: "expired"}     (terminal)
//	POST /api/auth/cli/refresh    body: {refresh_token}
//	    -> {access_token, refresh_token, expires_in}
package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Errors returned by the device flow.
var (
	ErrPending     = errors.New("authorization pending")
	ErrDenied      = errors.New("authorization denied")
	ErrExpired     = errors.New("authorization request expired")
	ErrSlowDown    = errors.New("polling too fast — slow down")
	ErrUnauthorized = errors.New("token rejected — re-authenticate")
)

// Client is a stateless HTTP client for the /api/auth/cli/* endpoints.
type Client struct {
	BaseURL string       // e.g. https://app.langwatch.ai
	HTTP    *http.Client // optional; defaults to http.DefaultClient
}

// DeviceCode is the response from POST /api/auth/cli/device-code.
type DeviceCode struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete,omitempty"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// ExchangeResult is the success body of POST /api/auth/cli/exchange.
type ExchangeResult struct {
	AccessToken       string             `json:"access_token"`
	RefreshToken      string             `json:"refresh_token"`
	ExpiresIn         int                `json:"expires_in"`
	User              ExchangeUser       `json:"user"`
	Organization      ExchangeOrg        `json:"organization"`
	DefaultPersonalVK ExchangePersonalVK `json:"default_personal_vk"`
}

// ExchangeUser carries the authenticated user's identity.
type ExchangeUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

// ExchangeOrg carries the org the user logged into.
type ExchangeOrg struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// ExchangePersonalVK is the auto-issued personal VK (the actual call
// to virtualKey.issuePersonal is server-side at exchange time so the
// CLI gets a usable VK in one round-trip).
type ExchangePersonalVK struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
	Prefix string `json:"prefix"`
}

// RefreshResult is the success body of POST /api/auth/cli/refresh.
type RefreshResult struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// StartDeviceCode initiates a device-code flow.
func (c *Client) StartDeviceCode(ctx context.Context) (*DeviceCode, error) {
	var dc DeviceCode
	if err := c.post(ctx, "/api/auth/cli/device-code", nil, &dc); err != nil {
		return nil, err
	}
	if dc.Interval <= 0 {
		dc.Interval = 5
	}
	return &dc, nil
}

// Exchange polls the exchange endpoint with the device code. Returns
// ErrPending while the user has not yet completed the browser flow,
// ErrDenied if the user explicitly denies, ErrExpired if the device
// code expires before completion. Callers loop until non-pending.
func (c *Client) Exchange(ctx context.Context, deviceCode string) (*ExchangeResult, error) {
	body := map[string]string{"device_code": deviceCode}
	req, err := c.buildRequest(ctx, http.MethodPost, "/api/auth/cli/exchange", body)
	if err != nil {
		return nil, err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var r ExchangeResult
		if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
			return nil, fmt.Errorf("decode exchange success: %w", err)
		}
		return &r, nil
	case http.StatusPreconditionRequired:
		return nil, ErrPending
	case http.StatusGone:
		return nil, ErrDenied
	case http.StatusRequestTimeout:
		return nil, ErrExpired
	case http.StatusTooManyRequests:
		return nil, ErrSlowDown
	default:
		return nil, c.unexpectedStatus(resp)
	}
}

// PollUntilDone repeats Exchange every dc.Interval seconds until the
// user completes the flow, the code expires, or ctx is cancelled.
//
// Per RFC 8628 §3.5, on a slow_down (429) the client MUST add ≥5s to
// the polling interval; we double the current interval up to a 60s
// ceiling so a misbehaving server can't burn battery.
func (c *Client) PollUntilDone(ctx context.Context, dc *DeviceCode) (*ExchangeResult, error) {
	interval := time.Duration(dc.Interval) * time.Second
	const intervalCeiling = 60 * time.Second
	deadline := time.Now().Add(time.Duration(dc.ExpiresIn) * time.Second)

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
		if time.Now().After(deadline) {
			return nil, ErrExpired
		}
		r, err := c.Exchange(ctx, dc.DeviceCode)
		if err == nil {
			return r, nil
		}
		switch {
		case errors.Is(err, ErrPending):
			continue
		case errors.Is(err, ErrSlowDown):
			interval *= 2
			if interval > intervalCeiling {
				interval = intervalCeiling
			}
			continue
		}
		return nil, err
	}
}

// Refresh exchanges a refresh token for a new access token. Returns
// ErrUnauthorized on 401 — callers should clear local state when this
// happens (the refresh token has been revoked or expired).
func (c *Client) Refresh(ctx context.Context, refreshToken string) (*RefreshResult, error) {
	req, err := c.buildRequest(ctx, http.MethodPost, "/api/auth/cli/refresh",
		map[string]string{"refresh_token": refreshToken})
	if err != nil {
		return nil, err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("refresh: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}
	if resp.StatusCode/100 != 2 {
		return nil, c.unexpectedStatus(resp)
	}
	var r RefreshResult
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, fmt.Errorf("decode refresh: %w", err)
	}
	return &r, nil
}

// Revoke server-side-revokes a refresh token. Used by `langwatch
// logout` so a leaked refresh token can't be reused even if the
// local config file isn't cleared (e.g. someone copied it). Treats
// 401/404 as success — the token was already gone.
func (c *Client) Revoke(ctx context.Context, refreshToken string) error {
	req, err := c.buildRequest(ctx, http.MethodPost, "/api/auth/cli/revoke",
		map[string]string{"refresh_token": refreshToken})
	if err != nil {
		return err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return fmt.Errorf("revoke: %w", err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode/100 == 2,
		resp.StatusCode == http.StatusUnauthorized,
		resp.StatusCode == http.StatusNotFound:
		return nil
	default:
		return c.unexpectedStatus(resp)
	}
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	req, err := c.buildRequest(ctx, http.MethodPost, path, body)
	if err != nil {
		return err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return c.unexpectedStatus(resp)
	}
	if out == nil {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

func (c *Client) buildRequest(ctx context.Context, method, path string, body any) (*http.Request, error) {
	url := strings.TrimRight(c.BaseURL, "/") + path
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return nil, fmt.Errorf("build req: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if rdr != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

func (c *Client) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Client) unexpectedStatus(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}
