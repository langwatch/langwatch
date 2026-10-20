package providers

// Gemini is one provider with two Google doors: a bare key dispatches to
// Bifrost's stock Gemini provider (generativelanguage.googleapis.com), a key
// carrying a project and region dispatches through a derived custom provider
// whose base URL names the Agent Platform path. Bifrost's Gemini provider
// appends "/models/{model}:generateContent" and sends the key as
// x-goog-api-key — both verified live against Agent Platform — so the door
// is entirely a base-URL prefix. See
// specs/model-providers/google-agent-platform.feature.

import (
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func agentPlatformCred() domain.Credential {
	return domain.Credential{
		ID:         "cred-gap",
		ProviderID: domain.ProviderGemini,
		APIKey:     "AQ.agent-platform-key",
		Extra: map[string]string{
			"project_id": "acme-123",
			"region":     "us-central1",
		},
	}
}

func TestMapProviderGeminiBareKeyStaysStock(t *testing.T) {
	cred := domain.Credential{
		ProviderID: domain.ProviderGemini,
		APIKey:     "AIza-studio-key",
	}
	if got := mapProvider(cred); got != bfschemas.Gemini {
		t.Fatalf("mapProvider(bare gemini key) = %q, want stock Gemini", got)
	}
}

func TestMapProviderGeminiAgentPlatformDerivesCustomProvider(t *testing.T) {
	got := mapProvider(agentPlatformCred())
	if !strings.HasPrefix(string(got), geminiCompatPrefix) {
		t.Fatalf("mapProvider(agent-platform cred) = %q, want %q-prefixed derived provider", got, geminiCompatPrefix)
	}
}

func TestMapProviderGeminiHalfPairStaysStock(t *testing.T) {
	// One field without the other names no door — the materialiser emits
	// the pair together or not at all, so a half pair is a malformed
	// credential that must not invent an Agent Platform URL.
	for _, extra := range []map[string]string{
		{"project_id": "acme-123"},
		{"region": "us-central1"},
	} {
		cred := domain.Credential{
			ProviderID: domain.ProviderGemini,
			APIKey:     "k",
			Extra:      extra,
		}
		if got := mapProvider(cred); got != bfschemas.Gemini {
			t.Fatalf("mapProvider(half pair %v) = %q, want stock Gemini", extra, got)
		}
	}
}

func TestGeminiAgentPlatformEndpointNamesProjectAndLocation(t *testing.T) {
	endpoint, key := geminiAgentPlatformEndpointForCred(agentPlatformCred())

	want := "https://aiplatform.googleapis.com/v1/projects/acme-123/locations/us-central1/publishers/google"
	if endpoint.baseURL != want {
		t.Fatalf("baseURL = %q, want %q", endpoint.baseURL, want)
	}
	if endpoint.baseType != bfschemas.Gemini {
		t.Fatalf("baseType = %q, want Gemini", endpoint.baseType)
	}
	if endpoint.keyless {
		t.Fatal("agent-platform endpoints always carry a key")
	}
	if !strings.HasPrefix(string(key), geminiCompatPrefix) {
		t.Fatalf("derived key %q missing %q prefix", key, geminiCompatPrefix)
	}
}

func TestGeminiAgentPlatformEndpointIsStablePerDoor(t *testing.T) {
	_, key1 := geminiAgentPlatformEndpointForCred(agentPlatformCred())
	_, key2 := geminiAgentPlatformEndpointForCred(agentPlatformCred())
	if key1 != key2 {
		t.Fatalf("same door derived two keys: %q vs %q", key1, key2)
	}

	other := agentPlatformCred()
	other.Extra["region"] = "europe-west4"
	_, key3 := geminiAgentPlatformEndpointForCred(other)
	if key3 == key1 {
		t.Fatal("distinct doors must derive distinct keys")
	}

	// Rotating the API key alone must not spawn a new provider pool.
	rotated := agentPlatformCred()
	rotated.APIKey = "AQ.rotated"
	_, key4 := geminiAgentPlatformEndpointForCred(rotated)
	if key4 != key1 {
		t.Fatalf("key rotation changed the derived provider: %q vs %q", key4, key1)
	}
}

func TestCompatRegistryResolvesGeminiEndpointConfig(t *testing.T) {
	reg := newAnthropicCompatRegistry(4)
	key := reg.register(agentPlatformCred())

	endpoint, ok := reg.lookup(string(key))
	if !ok {
		t.Fatalf("registered endpoint not found under %q", key)
	}
	if endpoint.baseType != bfschemas.Gemini {
		t.Fatalf("registry returned baseType %q, want Gemini", endpoint.baseType)
	}
}

// @scenario "A Gemini or Vertex provider with a base URL reaches that host instead of Google's"
func TestGeminiBaseURLOverrideReplacesGoogleHost(t *testing.T) {
	bare := domain.Credential{ProviderID: domain.ProviderGemini, APIKey: "llmsim", Extra: map[string]string{"base_url": "http://127.0.0.1:21651/v1"}}
	if got := mapProvider(bare); !strings.HasPrefix(string(got), geminiCompatPrefix) {
		t.Fatalf("mapProvider(gemini with base_url) = %q, want a derived provider", got)
	}
	if endpoint, _ := geminiAgentPlatformEndpointForCred(bare); endpoint.baseURL != "http://127.0.0.1:21651/v1" || endpoint.keyless {
		t.Fatalf("a bare key keeps the override as the API root: %+v", endpoint)
	}
	root := bare
	root.Extra = map[string]string{"base_url": "http://127.0.0.1:21651/"}
	if endpoint, _ := geminiAgentPlatformEndpointForCred(root); endpoint.baseURL != "http://127.0.0.1:21651/v1beta" {
		t.Fatalf("a host-only override gets Gemini's /v1beta: %q", endpoint.baseURL)
	}

	door := agentPlatformCred()
	door.Extra["base_url"] = "http://127.0.0.1:21651/v1"
	want := "http://127.0.0.1:21651/v1/projects/acme-123/locations/us-central1/publishers/google"
	if endpoint, _ := geminiAgentPlatformEndpointForCred(door); endpoint.baseURL != want {
		t.Fatalf("the Agent Platform door keeps its path on the override host: %q, want %q", endpoint.baseURL, want)
	}
}

// @scenario "A Gemini or Vertex provider with a base URL reaches that host instead of Google's"
func TestVertexBaseURLOverrideTakesTheDerivedGeminiProvider(t *testing.T) {
	cred := domain.Credential{ProviderID: domain.ProviderVertex, Extra: map[string]string{"project_id": "p1", "region": "us-central1"}}
	if got := mapProvider(cred); got != bfschemas.Vertex {
		t.Fatalf("vertex without an override stays stock: %q", got)
	}
	cred.Extra["base_url"] = "http://127.0.0.1:21651"
	got := mapProvider(cred)
	if !strings.HasPrefix(string(got), geminiCompatPrefix) {
		t.Fatalf("vertex with base_url = %q, want a derived Gemini-type provider", got)
	}
	endpoint, _ := compatEndpointForCred(cred)
	if endpoint.baseURL != "http://127.0.0.1:21651/v1/projects/p1/locations/us-central1/publishers/google" || !endpoint.keyless {
		t.Fatalf("vertex override endpoint: %+v", endpoint)
	}
	cred.APIKey = `{"type":"service_account"}`
	if endpoint, _ := compatEndpointForCred(cred); !endpoint.keyless {
		t.Fatal("service-account JSON in the key slot is never sent as an API key")
	}
}
