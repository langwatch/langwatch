// Package config persists langwatch CLI credentials at ~/.langwatch/config.json.
//
// The file is written with 0600 perms and contains the access token,
// refresh token, gateway base URL, and the user/org/personal-VK metadata
// returned at exchange time. Subcommands read it to configure the
// upstream gateway env vars they inject into wrapped tools.
//
// We deliberately use stdlib JSON over TOML/YAML to avoid adding a
// dependency for what is a tiny config blob.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Config is the on-disk shape of ~/.langwatch/config.json.
type Config struct {
	// GatewayURL is the LangWatch gateway base URL (e.g. https://gateway.langwatch.ai).
	GatewayURL string `json:"gateway_url"`

	// ControlPlaneURL is the LangWatch app base URL (e.g. https://app.langwatch.ai).
	// CLI hits this for /api/auth/cli/* and dashboard links.
	ControlPlaneURL string `json:"control_plane_url"`

	// AccessToken is the short-lived bearer token for the gateway.
	AccessToken string `json:"access_token,omitempty"`

	// RefreshToken is the long-lived token for refreshing AccessToken.
	RefreshToken string `json:"refresh_token,omitempty"`

	// ExpiresAt is the Unix epoch (seconds) when AccessToken expires.
	ExpiresAt int64 `json:"expires_at,omitempty"`

	// User identity returned at exchange time.
	User Identity `json:"user,omitempty"`

	// Organization the user is logged into.
	Organization Organization `json:"organization,omitempty"`

	// DefaultPersonalVK is the personal virtual-key secret prefix
	// auto-issued at login. The full secret is in PersonalVKSecret.
	DefaultPersonalVK PersonalVK `json:"default_personal_vk,omitempty"`

	// LastRequestIncreaseURL is the most recent signed
	// `request_increase_url` returned by the gateway in a
	// budget_exceeded 402 payload. Cached here so
	// `langwatch request-increase` can open the exact URL the
	// gateway produced (with HMAC'd user/limit/spent query params)
	// rather than reconstructing one — see budget-exceeded.feature.
	LastRequestIncreaseURL string `json:"last_request_increase_url,omitempty"`
}

// Identity represents the authenticated user.
type Identity struct {
	ID    string `json:"id,omitempty"`
	Email string `json:"email,omitempty"`
	Name  string `json:"name,omitempty"`
}

// Organization represents the org the user is logged into.
type Organization struct {
	ID   string `json:"id,omitempty"`
	Slug string `json:"slug,omitempty"`
	Name string `json:"name,omitempty"`
}

// PersonalVK is the personal VK auto-issued at login, used as the
// Authorization bearer for Claude Code / Codex / Cursor / Gemini calls.
type PersonalVK struct {
	ID     string `json:"id,omitempty"`
	Secret string `json:"secret,omitempty"`
	Prefix string `json:"prefix,omitempty"`
}

// Path returns the absolute path to the config file.
func Path() (string, error) {
	if env := os.Getenv("LANGWATCH_CLI_CONFIG"); env != "" {
		return env, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("locate home dir: %w", err)
	}
	return filepath.Join(home, ".langwatch", "config.json"), nil
}

// Load reads the config from disk. Returns a zero-value Config if the
// file does not exist (caller can detect via cfg.AccessToken == "").
func Load() (*Config, error) {
	p, err := Path()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return defaults(), nil
		}
		return nil, fmt.Errorf("read %s: %w", p, err)
	}
	cfg := defaults()
	if err := json.Unmarshal(b, cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", p, err)
	}
	return cfg, nil
}

// Save persists the config with 0600 perms, creating the parent dir if needed.
func Save(cfg *Config) error {
	p, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, p); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// Clear deletes the config file. Used by `langwatch logout`.
func Clear() error {
	p, err := Path()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// LoggedIn reports whether the loaded config has credentials.
func (c *Config) LoggedIn() bool {
	return c != nil && c.AccessToken != ""
}

// defaults returns a Config with default endpoints filled in. Env var
// overrides allow self-hosted users to point at their own instance.
func defaults() *Config {
	gw := os.Getenv("LANGWATCH_GATEWAY_URL")
	if gw == "" {
		gw = "https://gateway.langwatch.ai"
	}
	cp := os.Getenv("LANGWATCH_URL")
	if cp == "" {
		cp = "https://app.langwatch.ai"
	}
	return &Config{
		GatewayURL:      gw,
		ControlPlaneURL: cp,
	}
}
