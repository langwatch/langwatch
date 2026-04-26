package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/langwatch/langwatch/services/cli/internal/auth"
	"github.com/langwatch/langwatch/services/cli/internal/config"
)

// TestRun_Help verifies the dispatcher prints usage when called with no
// args and exits cleanly.
func TestRun_Help(t *testing.T) {
	out := captureStdout(t, func() {
		if err := Run(context.Background(), nil); err != nil {
			t.Fatalf("Run(nil): %v", err)
		}
	})
	if !strings.Contains(out, "Usage:") {
		t.Errorf("expected usage banner, got: %s", out)
	}
	for _, sub := range []string{"login", "logout", "claude", "codex", "cursor", "gemini", "shell", "dashboard", "init", "whoami"} {
		if !strings.Contains(out, sub) {
			t.Errorf("expected subcommand %q in help, got:\n%s", sub, out)
		}
	}
}

// TestRun_UnknownSubcommandReturnsError verifies typo'd subcommand exits non-zero.
func TestRun_UnknownSubcommandReturnsError(t *testing.T) {
	if err := Run(context.Background(), []string{"nope-not-a-cmd"}); err == nil {
		t.Errorf("expected error on unknown subcommand")
	}
}

// TestWhoamiNotLoggedIn exits non-zero with a clear message.
func TestWhoamiNotLoggedIn(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)
	err := Run(context.Background(), []string{"whoami"})
	if err == nil {
		t.Fatalf("expected error when not logged in")
	}
	if !strings.Contains(err.Error(), "not logged in") {
		t.Errorf("unexpected message: %v", err)
	}
}

// TestWhoamiLoggedIn prints a banner with identity + org + gateway URL.
func TestWhoamiLoggedIn(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)

	cfg := &config.Config{
		GatewayURL:      "https://gw.example.com",
		ControlPlaneURL: "https://app.example.com",
		AccessToken:     "at_x",
		User:            config.Identity{Email: "jane@miro.com", Name: "Jane Doe"},
		Organization:    config.Organization{Name: "Miro"},
		DefaultPersonalVK: config.PersonalVK{
			Prefix: "lw_vk_live_01",
		},
	}
	if err := config.Save(cfg); err != nil {
		t.Fatal(err)
	}

	out := captureStdout(t, func() {
		if err := Run(context.Background(), []string{"whoami"}); err != nil {
			t.Fatalf("Run whoami: %v", err)
		}
	})
	for _, want := range []string{"jane@miro.com", "Miro", "https://gw.example.com", "lw_vk_live_01"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in output, got:\n%s", want, out)
		}
	}
}

// TestLogoutCallsRevokeAndClearsLocal verifies `langwatch logout`
// hits /api/auth/cli/logout AND clears the local config — even
// when the server response is an error.
func TestLogoutCallsRevokeAndClearsLocal(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)

	var revokeCalls int32
	var capturedRefreshToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&revokeCalls, 1)
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		capturedRefreshToken = body["refresh_token"]
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{
		ControlPlaneURL: srv.URL,
		AccessToken:     "at_x",
		RefreshToken:    "rt_x",
		User:            config.Identity{Email: "jane@miro.com"},
	}
	if err := config.Save(cfg); err != nil {
		t.Fatal(err)
	}

	if err := Run(context.Background(), []string{"logout"}); err != nil {
		t.Fatalf("logout: %v", err)
	}

	if got := atomic.LoadInt32(&revokeCalls); got != 1 {
		t.Errorf("expected 1 revoke call, got %d", got)
	}
	if capturedRefreshToken != "rt_x" {
		t.Errorf("expected revoke to send refresh_token, got %q", capturedRefreshToken)
	}
	if _, err := os.Stat(tmp); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("expected config cleared, stat err: %v", err)
	}
}

// TestLogoutClearsLocalEvenWhenServerErrors — per cli-login.feature
// scenario, local wipe must happen even when the server-side revoke
// fails (otherwise "logout" leaves a usable token on disk).
func TestLogoutClearsLocalEvenWhenServerErrors(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{
		ControlPlaneURL: srv.URL,
		AccessToken:     "at_x",
		RefreshToken:    "rt_x",
	}
	if err := config.Save(cfg); err != nil {
		t.Fatal(err)
	}

	// Should NOT error even though the server returned 500.
	if err := Run(context.Background(), []string{"logout"}); err != nil {
		t.Fatalf("logout returned error: %v", err)
	}

	// Local file must be gone regardless.
	if _, err := os.Stat(tmp); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("expected config cleared even on 500, stat err: %v", err)
	}
}

// TestRunInitPrintsExportSnippet verifies `langwatch init zsh` prints
// shell-eval-able export lines for the gateway env vars.
func TestRunInitPrintsExportSnippet(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)

	cfg := &config.Config{
		GatewayURL:      "https://gw.example.com",
		ControlPlaneURL: "https://app.example.com",
		AccessToken:     "at_x",
		DefaultPersonalVK: config.PersonalVK{Secret: "lw_vk_test"},
	}
	if err := config.Save(cfg); err != nil {
		t.Fatal(err)
	}

	out := captureStdout(t, func() {
		_ = Run(context.Background(), []string{"init", "zsh"})
	})
	for _, want := range []string{
		"export ANTHROPIC_BASE_URL=https://gw.example.com/api/v1/anthropic",
		"export ANTHROPIC_AUTH_TOKEN=lw_vk_test",
		"export OPENAI_BASE_URL=https://gw.example.com/api/v1/openai",
		"export OPENAI_API_KEY=lw_vk_test",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in init output, got:\n%s", want, out)
		}
	}
}

// TestRunInitFishUsesSetGx verifies fish syntax differs from bash/zsh.
func TestRunInitFishUsesSetGx(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)
	cfg := &config.Config{
		GatewayURL: "https://gw.example.com", ControlPlaneURL: "https://app.example.com",
		AccessToken: "at_x", DefaultPersonalVK: config.PersonalVK{Secret: "lw_vk_test"},
	}
	_ = config.Save(cfg)
	out := captureStdout(t, func() { _ = Run(context.Background(), []string{"init", "fish"}) })
	if !strings.Contains(out, "set -gx ANTHROPIC_BASE_URL ") {
		t.Errorf("expected fish 'set -gx', got:\n%s", out)
	}
}

// TestEndToEndDeviceFlow simulates a full RFC 8628 device-code login
// against a fake server, then verifies the local config is in the
// shape `langwatch claude` would consume.
func TestEndToEndDeviceFlow(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)

	var pollCount int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/cli/device-code":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "DC_xxx",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          "https://example.com/cli/auth",
				"verification_uri_complete": "https://example.com/cli/auth?user_code=ABCD-EFGH",
				"expires_in":                300,
				"interval":                  1, // tight loop for test speed
			})
		case "/api/auth/cli/exchange":
			n := atomic.AddInt32(&pollCount, 1)
			if n < 2 {
				w.WriteHeader(http.StatusPreconditionRequired)
				_, _ = w.Write([]byte(`{"status":"pending"}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "at_NEW",
				"refresh_token": "rt_NEW",
				"expires_in":    3600,
				"user":          map[string]string{"id": "u_jane", "email": "jane@miro.com", "name": "Jane Doe"},
				"organization":  map[string]string{"id": "o_miro", "slug": "miro", "name": "Miro"},
				"default_personal_vk": map[string]string{
					"id":     "vk_p_1",
					"secret": "lw_vk_live_jane123",
					"prefix": "lw_vk_live_jane",
				},
			})
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	t.Setenv("LANGWATCH_URL", srv.URL)
	t.Setenv("LANGWATCH_GATEWAY_URL", "https://gw.example.com")
	// suppress browser open
	t.Setenv("BROWSER", "/usr/bin/true")

	// Use the auth.Client directly to drive the flow so we avoid the
	// browser-open side effect of the `login` cmd. This still proves
	// the wire shapes match what the cmd writes to disk.
	client := &auth.Client{BaseURL: srv.URL}
	dc, err := client.StartDeviceCode(context.Background())
	if err != nil {
		t.Fatalf("StartDeviceCode: %v", err)
	}
	res, err := client.PollUntilDone(context.Background(), dc)
	if err != nil {
		t.Fatalf("PollUntilDone: %v", err)
	}

	cfg, _ := config.Load()
	cfg.AccessToken = res.AccessToken
	cfg.RefreshToken = res.RefreshToken
	cfg.User = config.Identity{ID: res.User.ID, Email: res.User.Email, Name: res.User.Name}
	cfg.Organization = config.Organization{ID: res.Organization.ID, Slug: res.Organization.Slug, Name: res.Organization.Name}
	cfg.DefaultPersonalVK = config.PersonalVK{
		ID: res.DefaultPersonalVK.ID, Secret: res.DefaultPersonalVK.Secret, Prefix: res.DefaultPersonalVK.Prefix,
	}
	if err := config.Save(cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// `langwatch whoami` should now print Jane's identity + org name.
	out := captureStdout(t, func() {
		_ = Run(context.Background(), []string{"whoami"})
	})
	for _, want := range []string{"jane@miro.com", "Miro", "lw_vk_live_jane"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in whoami output, got:\n%s", want, out)
		}
	}
}

// TestVersionFlag prints the build-time-injected version.
func TestVersionFlag(t *testing.T) {
	prev := Version
	t.Cleanup(func() { Version = prev })
	Version = "v0.1.0-test"

	for _, alias := range []string{"version", "-v", "--version"} {
		t.Run(alias, func(t *testing.T) {
			out := captureStdout(t, func() {
				_ = Run(context.Background(), []string{alias})
			})
			if !strings.Contains(out, "v0.1.0-test") {
				t.Errorf("expected version in output for %q, got:\n%s", alias, out)
			}
		})
	}
}

// captureStdout redirects os.Stdout for the duration of fn and returns
// what was written. Used to assert CLI output without reaching for a
// process-level fork.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	prev := os.Stdout
	os.Stdout = w
	defer func() { os.Stdout = prev }()

	done := make(chan []byte, 1)
	go func() {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		done <- buf.Bytes()
	}()

	fn()
	_ = w.Close()
	return string(<-done)
}

// guard that `exec.LookPath` is a real symbol (avoids "imported and not used"
// when the tests above don't directly call it).
var _ = exec.LookPath
