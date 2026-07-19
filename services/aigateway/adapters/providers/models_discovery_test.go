package providers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "GET /v1/models discovers models from self-hosted endpoints"
// Credentials with a base URL are asked for their OpenAI-shape /v1/models
// list (vLLM, LiteLLM, and Anthropic-compatible servers all serve it);
// credentials without one are skipped — there is no catalog to query.
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_QueriesBaseURLCredentials(t *testing.T) {
	var captured struct {
		path string
		auth string
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.path = r.URL.Path
		captured.auth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"qwen3-14b","object":"model"},{"id":"bge-m3","object":"model"}]}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		// Conventional "/v1" suffix must not produce ".../v1/v1/models".
		{ID: "mp-1", ProviderID: domain.ProviderAnthropic, APIKey: "sk-local", Extra: map[string]string{"base_url": srv.URL + "/v1"}},
		{ID: "mp-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-hosted"}, // no base URL — skipped
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}

	if captured.path != "/v1/models" {
		t.Fatalf("upstream path = %q, want /v1/models", captured.path)
	}
	if captured.auth != "Bearer sk-local" {
		t.Fatalf("Authorization = %q, want the credential's key as bearer", captured.auth)
	}
	ids := make([]string, 0, len(models))
	for _, m := range models {
		ids = append(ids, m.ID)
		if m.ProviderID != domain.ProviderAnthropic {
			t.Fatalf("model %q attributed to %q, want the discovering credential's provider", m.ID, m.ProviderID)
		}
	}
	if len(ids) != 2 || ids[0] != "qwen3-14b" || ids[1] != "bge-m3" {
		t.Fatalf("models = %v, want [qwen3-14b bge-m3]", ids)
	}
}

// A server that fails to answer is skipped without failing the request —
// one dead endpoint must not blank out the whole model list.
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_SkipsFailingEndpoint(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer dead.Close()
	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	}))
	defer alive.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-dead", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": dead.URL}},
		{ID: "mp-alive", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": alive.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if len(models) != 1 || models[0].ID != "qwen3-14b" {
		t.Fatalf("models = %v, want only the live endpoint's model", models)
	}
}

// Unauthenticated self-hosted servers get no Authorization header, and the
// same model served by two endpoints appears once.
func TestListModels_NoAuthHeaderWhenKeyEmptyAndDedupes(t *testing.T) {
	var sawAuth bool
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sawAuth = true
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	})
	srv1 := httptest.NewServer(handler)
	defer srv1.Close()
	srv2 := httptest.NewServer(handler)
	defer srv2.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-1", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": srv1.URL}},
		{ID: "mp-2", ProviderID: domain.ProviderCustom, Extra: map[string]string{"api_base": srv2.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if sawAuth {
		t.Fatal("Authorization header sent for an empty API key")
	}
	if len(models) != 1 {
		t.Fatalf("models = %v, want the shared model deduped to one entry", models)
	}
}
