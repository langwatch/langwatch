package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

func TestEnsureFreshSkipsWhenTokenStillFresh(t *testing.T) {
	t.Setenv("LANGWATCH_CLI_CONFIG", filepath.Join(t.TempDir(), "c.json"))

	var refreshCalled int32
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&refreshCalled, 1)
	}))
	t.Cleanup(srv.Close)

	now := time.Date(2026, 4, 26, 12, 0, 0, 0, time.UTC)
	cfg := &config.Config{
		ControlPlaneURL: srv.URL,
		AccessToken:     "at_x",
		RefreshToken:    "rt_x",
		ExpiresAt:       now.Add(60 * time.Minute).Unix(), // plenty of time
	}
	client := &Client{BaseURL: srv.URL}

	if err := EnsureFresh(context.Background(), cfg, client, func() time.Time { return now }); err != nil {
		t.Fatalf("EnsureFresh: %v", err)
	}
	if atomic.LoadInt32(&refreshCalled) != 0 {
		t.Errorf("expected no refresh call, got %d", refreshCalled)
	}
}

func TestEnsureFreshRefreshesWhenNearExpiry(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "c.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)

	var refreshCalled int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&refreshCalled, 1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "at_NEW",
			"refresh_token": "rt_NEW",
			"expires_in":    3600,
		})
	}))
	t.Cleanup(srv.Close)

	now := time.Date(2026, 4, 26, 12, 0, 0, 0, time.UTC)
	cfg := &config.Config{
		ControlPlaneURL: srv.URL,
		AccessToken:     "at_OLD",
		RefreshToken:    "rt_OLD",
		ExpiresAt:       now.Add(2 * time.Minute).Unix(), // within 5min threshold
	}
	client := &Client{BaseURL: srv.URL}

	if err := EnsureFresh(context.Background(), cfg, client, func() time.Time { return now }); err != nil {
		t.Fatalf("EnsureFresh: %v", err)
	}
	if atomic.LoadInt32(&refreshCalled) != 1 {
		t.Errorf("expected 1 refresh call, got %d", refreshCalled)
	}
	if cfg.AccessToken != "at_NEW" {
		t.Errorf("expected AccessToken rotated, got %q", cfg.AccessToken)
	}
	if cfg.RefreshToken != "rt_NEW" {
		t.Errorf("expected RefreshToken rotated, got %q", cfg.RefreshToken)
	}

	// Verify it persisted
	loaded, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.AccessToken != "at_NEW" {
		t.Errorf("disk did not persist new AccessToken: got %q", loaded.AccessToken)
	}
}

func TestEnsureFreshOn401ClearsLocal(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "c.json")
	t.Setenv("LANGWATCH_CLI_CONFIG", tmp)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"refresh_token_revoked"}`))
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{
		ControlPlaneURL: srv.URL,
		AccessToken:     "at_x",
		RefreshToken:    "rt_x",
		ExpiresAt:       1, // far in the past — definitely needs refresh
	}
	if err := config.Save(cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}

	client := &Client{BaseURL: srv.URL}
	err := EnsureFresh(context.Background(), cfg, client, func() time.Time { return time.Now() })
	if !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("expected ErrSessionRevoked, got %v", err)
	}

	// Local file should have been cleared.
	loaded, _ := config.Load()
	if loaded != nil && loaded.LoggedIn() {
		t.Error("expected local config cleared after 401")
	}
}

func TestEnsureFreshNoOpWhenNotLoggedIn(t *testing.T) {
	t.Setenv("LANGWATCH_CLI_CONFIG", filepath.Join(t.TempDir(), "c.json"))
	cfg := &config.Config{} // empty config
	client := &Client{BaseURL: "http://does-not-matter"}
	if err := EnsureFresh(context.Background(), cfg, client, nil); err != nil {
		t.Errorf("expected nil error for not-logged-in, got %v", err)
	}
}

func TestRevokeTreats401As404AsSuccess(t *testing.T) {
	t.Run("404", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()
		c := &Client{BaseURL: srv.URL}
		if err := c.Revoke(context.Background(), "rt"); err != nil {
			t.Errorf("expected nil error on 404, got %v", err)
		}
	})
	t.Run("401", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()
		c := &Client{BaseURL: srv.URL}
		if err := c.Revoke(context.Background(), "rt"); err != nil {
			t.Errorf("expected nil error on 401, got %v", err)
		}
	})
	t.Run("200", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()
		c := &Client{BaseURL: srv.URL}
		if err := c.Revoke(context.Background(), "rt"); err != nil {
			t.Errorf("expected nil error on 200, got %v", err)
		}
	})
	t.Run("500_error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"oops"}`))
		}))
		defer srv.Close()
		c := &Client{BaseURL: srv.URL}
		if err := c.Revoke(context.Background(), "rt"); err == nil {
			t.Errorf("expected error on 500, got nil")
		}
	})
}
