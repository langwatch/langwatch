package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

func TestModels_NoBundle_503(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/models", nil)
	w := httptest.NewRecorder()
	Models(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("want 503 without bundle, got %d", w.Code)
	}
}

// TestModels_EmitsAliasesAllowedAndProviders constructs a bundle via
// the auth package's public helpers so the ctx key matches.
func TestModels_EmitsAliasesAllowedAndProviders(t *testing.T) {
	b := &auth.Bundle{
		Config: &auth.Config{
			ModelAliases:  map[string]string{"chat": "openai/gpt-5-mini", "fast": "anthropic/claude-haiku-4-5"},
			ModelsAllowed: []string{"gpt-5-mini", "claude-haiku-*"},
			ProviderCreds: []auth.ProviderCred{
				{ID: "pc_oa", Type: "openai"},
				{ID: "pc_an", Type: "anthropic"},
			},
		},
	}
	// Use auth.Middleware's writer to inject the bundle. Easier: the
	// production auth.Middleware reads the Authorization header and
	// stashes a Bundle; since we don't have a cache here, we call the
	// exported auth.BundleFromContext indirectly by constructing a
	// request whose ctx carries the bundle via the auth package's
	// public helpers.
	req := httptest.NewRequest("GET", "/v1/models", nil)
	req = auth.WithBundleForTest(req, b)
	w := httptest.NewRecorder()
	Models(w, req)
	if w.Code != 200 {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var resp modelsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, e := range resp.Data {
		ids[e.ID] = true
	}
	for _, want := range []string{
		// aliases
		"chat", "fast",
		// allowed patterns
		"gpt-5-mini", "claude-haiku-*",
		// provider shortcuts
		"openai/*", "anthropic/*",
	} {
		if !ids[want] {
			t.Errorf("expected entry %q in response; got %+v", want, ids)
		}
	}
}
