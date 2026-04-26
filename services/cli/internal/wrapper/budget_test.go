package wrapper

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

func TestCheckBudget_OK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{
		ControlPlaneURL: srv.URL,
		AccessToken:     "at_x",
	}
	be, err := CheckBudget(cfg, srv.Client())
	if err != nil {
		t.Fatalf("CheckBudget: %v", err)
	}
	if be != nil {
		t.Errorf("expected no budget exceeded, got %+v", be)
	}
}

func TestCheckBudget_402_RendersBox(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{
			"error": {
				"type": "budget_exceeded",
				"scope": "user",
				"limit_usd": "500.00",
				"spent_usd": "500.00",
				"period": "month",
				"request_increase_url": "https://app.langwatch.example.com/me/budget/request?token=abc",
				"admin_email": "platform-team@miro.com"
			}
		}`))
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{
		ControlPlaneURL: srv.URL,
		AccessToken:     "at_x",
	}
	be, err := CheckBudget(cfg, srv.Client())
	if err != nil {
		t.Fatalf("CheckBudget: %v", err)
	}
	if be == nil {
		t.Fatal("expected BudgetExceededError, got nil")
	}
	if be.Scope != "user" {
		t.Errorf("got scope %q want user", be.Scope)
	}
	if be.AdminEmail != "platform-team@miro.com" {
		t.Errorf("got admin email %q", be.AdminEmail)
	}

	// Render the box and verify it matches the spec exactly.
	var buf bytes.Buffer
	RenderBudgetExceeded(&buf, be)
	got := buf.String()

	want := []string{
		"⚠  Budget limit reached",
		"You've used $500.00 of your $500.00 monthly budget.",
		"To continue, ask your team admin to raise your limit.",
		"Admin: platform-team@miro.com",
		"Need urgent access? Run:",
		"langwatch request-increase",
	}
	for _, line := range want {
		if !strings.Contains(got, line) {
			t.Errorf("expected %q in budget box, got:\n%s", line, got)
		}
	}
}

func TestCheckBudget_404_GracefulFallback(t *testing.T) {
	// Older self-hosted server doesn't have the budget-status endpoint
	// yet — CLI should treat 404 as "no opinion" so older deploys still
	// work without the pre-check.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{ControlPlaneURL: srv.URL, AccessToken: "at_x"}
	be, err := CheckBudget(cfg, srv.Client())
	if err != nil {
		t.Errorf("expected nil error on 404, got %v", err)
	}
	if be != nil {
		t.Errorf("expected nil BudgetExceededError on 404, got %+v", be)
	}
}

func TestCheckBudget_NoOpWhenNotLoggedIn(t *testing.T) {
	cfg := &config.Config{ControlPlaneURL: "http://does-not-matter"}
	be, err := CheckBudget(cfg, nil)
	if err != nil {
		t.Errorf("expected nil err when not logged in, got %v", err)
	}
	if be != nil {
		t.Errorf("expected nil BudgetExceededError when not logged in, got %+v", be)
	}
}

func TestCheckBudget_PassesBearerToken(t *testing.T) {
	var seenAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{ControlPlaneURL: srv.URL, AccessToken: "at_TOKEN"}
	if _, err := CheckBudget(cfg, srv.Client()); err != nil {
		t.Fatal(err)
	}
	if seenAuth != "Bearer at_TOKEN" {
		t.Errorf("expected Bearer header, got %q", seenAuth)
	}
}

func TestRenderBudgetExceeded_TeamScope(t *testing.T) {
	be := &BudgetExceededError{
		Type:               "budget_exceeded",
		Scope:              "team",
		LimitUSD:           "1000.00",
		SpentUSD:           "1000.00",
		Period:             "month",
		RequestIncreaseURL: "https://app/team/budget",
		AdminEmail:         "team-lead@acme.com",
	}
	var buf bytes.Buffer
	RenderBudgetExceeded(&buf, be)
	out := buf.String()
	if !strings.Contains(out, "$1000.00 of your $1000.00") {
		t.Errorf("expected limit/spent in output, got:\n%s", out)
	}
	if !strings.Contains(out, "team-lead@acme.com") {
		t.Errorf("expected admin email in output, got:\n%s", out)
	}
}

func TestRenderBudgetExceeded_DefaultsToMonth(t *testing.T) {
	be := &BudgetExceededError{
		Type:     "budget_exceeded",
		Scope:    "user",
		LimitUSD: "10.00",
		SpentUSD: "10.00",
		// Period intentionally empty
	}
	var buf bytes.Buffer
	RenderBudgetExceeded(&buf, be)
	if !strings.Contains(buf.String(), "monthly budget") {
		t.Errorf("expected default 'monthly' when Period empty, got:\n%s", buf.String())
	}
}

// TestRenderBudgetExceeded_NoAdminEmail verifies the box still renders
// when the gateway omits admin_email — we don't want to print
// "Admin: <empty>".
func TestRenderBudgetExceeded_NoAdminEmail(t *testing.T) {
	be := &BudgetExceededError{
		Type:     "budget_exceeded",
		Scope:    "user",
		LimitUSD: "100.00",
		SpentUSD: "100.00",
		Period:   "month",
		// AdminEmail intentionally empty
	}
	var buf bytes.Buffer
	RenderBudgetExceeded(&buf, be)
	if strings.Contains(buf.String(), "Admin:") {
		t.Errorf("expected no Admin: line when AdminEmail empty, got:\n%s", buf.String())
	}
}

// LastRequestIncreaseURL roundtrip verifies the persisted URL the
// `langwatch request-increase` command will open later.
func TestConfig_LastRequestIncreaseURLPersists(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LANGWATCH_CLI_CONFIG", filepath.Join(dir, "config.json"))

	cfg := &config.Config{
		AccessToken:            "at_x",
		LastRequestIncreaseURL: "https://app.example.com/me/budget/request?token=abc&signed=1",
	}
	if err := config.Save(cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}
	loaded, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.LastRequestIncreaseURL != cfg.LastRequestIncreaseURL {
		t.Errorf("URL not persisted: got %q want %q",
			loaded.LastRequestIncreaseURL, cfg.LastRequestIncreaseURL)
	}
}
