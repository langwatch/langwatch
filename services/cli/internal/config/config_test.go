package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveAndLoadRoundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", path)

	want := &Config{
		GatewayURL:      "https://gw.example.com",
		ControlPlaneURL: "https://app.example.com",
		AccessToken:     "at_xxx",
		RefreshToken:    "rt_xxx",
		ExpiresAt:       1700000000,
		User:            Identity{ID: "u_1", Email: "j@example.com", Name: "Jane"},
		Organization:    Organization{ID: "o_1", Slug: "miro", Name: "Miro"},
		DefaultPersonalVK: PersonalVK{
			ID:     "vk_1",
			Secret: "lw_vk_secret",
			Prefix: "lw_vk_secre",
		},
	}
	if err := Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("expected 0600 perms, got %v", info.Mode().Perm())
	}

	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.AccessToken != want.AccessToken {
		t.Errorf("AccessToken mismatch: got %q want %q", got.AccessToken, want.AccessToken)
	}
	if got.User.Email != want.User.Email {
		t.Errorf("User.Email mismatch: got %q want %q", got.User.Email, want.User.Email)
	}
	if got.Organization.Slug != want.Organization.Slug {
		t.Errorf("Organization.Slug mismatch: got %q want %q", got.Organization.Slug, want.Organization.Slug)
	}
	if got.DefaultPersonalVK.Secret != want.DefaultPersonalVK.Secret {
		t.Errorf("VK.Secret mismatch")
	}
	if !got.LoggedIn() {
		t.Error("expected LoggedIn() = true after roundtrip")
	}
}

func TestLoadMissingFileReturnsDefaults(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LANGWATCH_CLI_CONFIG", filepath.Join(dir, "does-not-exist.json"))

	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.LoggedIn() {
		t.Error("expected LoggedIn() = false on missing file")
	}
	if got.GatewayURL == "" {
		t.Error("expected default GatewayURL filled in")
	}
	if got.ControlPlaneURL == "" {
		t.Error("expected default ControlPlaneURL filled in")
	}
}

func TestEnvOverridesDefaults(t *testing.T) {
	t.Setenv("LANGWATCH_CLI_CONFIG", filepath.Join(t.TempDir(), "c.json"))
	t.Setenv("LANGWATCH_GATEWAY_URL", "https://my-gateway.example/")
	t.Setenv("LANGWATCH_URL", "https://my-app.example/")

	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.GatewayURL != "https://my-gateway.example/" {
		t.Errorf("expected gateway override, got %q", got.GatewayURL)
	}
	if got.ControlPlaneURL != "https://my-app.example/" {
		t.Errorf("expected control plane override, got %q", got.ControlPlaneURL)
	}
}
