package providers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// An Anthropic credential with a base-URL override must not dispatch to
// api.anthropic.com. Bifrost's Anthropic key has no per-key URL slot and
// provider config is resolved by provider key alone, so the gateway derives
// a per-endpoint custom provider key (base provider Anthropic) whose config
// carries the URL. Deterministic derivation matters: bifrost caches one
// worker pool per provider key, so the same endpoint must always map to the
// same key.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
func TestMapProvider_AnthropicBaseURLDerivesCompatProvider(t *testing.T) {
	withURL := domain.Credential{
		ProviderID: domain.ProviderAnthropic,
		APIKey:     "sk-ant",
		Extra:      map[string]string{"base_url": "http://vllm:8000"},
	}

	got := mapProvider(withURL)
	if got == bfschemas.Anthropic {
		t.Fatal("anthropic cred with base_url must not map to the stock Anthropic provider")
	}
	if !strings.HasPrefix(string(got), anthropicCompatPrefix) {
		t.Fatalf("provider key = %q, want prefix %q", got, anthropicCompatPrefix)
	}

	if again := mapProvider(withURL); again != got {
		t.Fatalf("same endpoint must derive the same provider key: %q != %q", again, got)
	}

	otherURL := withURL
	otherURL.Extra = map[string]string{"base_url": "http://other:9000"}
	if other := mapProvider(otherURL); other == got {
		t.Fatalf("different endpoints must not share a provider key: both %q", got)
	}

	litellmStyle := withURL
	litellmStyle.Extra = map[string]string{"api_base": "http://vllm:8000"}
	if alias := mapProvider(litellmStyle); alias != got {
		t.Fatalf("api_base alias must derive the same key as base_url: %q != %q", alias, got)
	}

	noURL := domain.Credential{ProviderID: domain.ProviderAnthropic, APIKey: "sk-ant"}
	if plain := mapProvider(noURL); plain != bfschemas.Anthropic {
		t.Fatalf("anthropic cred without base_url = %q, want stock Anthropic", plain)
	}
}

// GetConfigForProvider is where bifrost picks up the endpoint: the derived
// key must resolve to a config with base provider Anthropic and the
// normalized base URL, on top of the gateway-wide network settings.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
func TestGetConfigForProvider_AnthropicCompatCarriesBaseURL(t *testing.T) {
	provider := mapProvider(domain.Credential{
		ProviderID: domain.ProviderAnthropic,
		APIKey:     "sk-ant",
		// Conventional "/v1" suffix: Bifrost's Anthropic provider appends
		// the full "/v1/messages" path itself, so the suffix must be
		// stripped or requests land on ".../v1/v1/messages".
		Extra: map[string]string{"base_url": "http://vllm:8000/v1"},
	})

	cfg, err := (&account{}).GetConfigForProvider(provider)
	if err != nil {
		t.Fatalf("GetConfigForProvider(%q) error: %v", provider, err)
	}
	if cfg.CustomProviderConfig == nil {
		t.Fatal("CustomProviderConfig is nil: bifrost cannot resolve the base provider type without it")
	}
	if cfg.CustomProviderConfig.BaseProviderType != bfschemas.Anthropic {
		t.Fatalf("BaseProviderType = %q, want Anthropic", cfg.CustomProviderConfig.BaseProviderType)
	}
	if cfg.CustomProviderConfig.IsKeyLess {
		t.Fatal("IsKeyLess = true for a credential with an API key; bifrost would skip key selection and drop the key")
	}
	if cfg.NetworkConfig.BaseURL != "http://vllm:8000" {
		t.Fatalf("NetworkConfig.BaseURL = %q, want normalized URL without /v1 suffix", cfg.NetworkConfig.BaseURL)
	}
	if cfg.NetworkConfig.DefaultRequestTimeoutInSeconds != 14*60 {
		t.Fatalf("DefaultRequestTimeoutInSeconds = %d, want the gateway-wide 14m ceiling", cfg.NetworkConfig.DefaultRequestTimeoutInSeconds)
	}
}

// Self-hosted Anthropic-compatible servers commonly run unauthenticated.
// Bifrost's key selection filters out empty-value keys for base provider
// Anthropic and fails the dispatch, so a credential without an API key must
// produce a keyless custom provider (key selection skipped entirely) — and
// a distinct provider key, since keyless-ness lives on the provider config.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
func TestGetConfigForProvider_AnthropicCompatKeylessWhenNoAPIKey(t *testing.T) {
	withKey := domain.Credential{
		ProviderID: domain.ProviderAnthropic,
		APIKey:     "sk-ant",
		Extra:      map[string]string{"base_url": "http://vllm:8000"},
	}
	withoutKey := withKey
	withoutKey.APIKey = ""

	keyedProvider := mapProvider(withKey)
	keylessProvider := mapProvider(withoutKey)
	if keyedProvider == keylessProvider {
		t.Fatal("keyed and keyless creds for the same endpoint must not share a provider key: the keyless flag lives on the provider config")
	}

	cfg, err := (&account{}).GetConfigForProvider(keylessProvider)
	if err != nil {
		t.Fatalf("GetConfigForProvider(%q) error: %v", keylessProvider, err)
	}
	if cfg.CustomProviderConfig == nil || !cfg.CustomProviderConfig.IsKeyLess {
		t.Fatal("credential without an API key must produce IsKeyLess=true, or bifrost's key selection rejects the empty key")
	}
}

// A compat-prefixed provider key that was never derived by mapProvider has
// no endpoint to dial — surfacing a config error beats silently dispatching
// to api.anthropic.com.
func TestGetConfigForProvider_UnregisteredAnthropicCompatKeyErrors(t *testing.T) {
	_, err := (&account{}).GetConfigForProvider(bfschemas.ModelProvider(anthropicCompatPrefix + "deadbeefdeadbeef"))
	if err == nil {
		t.Fatal("unregistered compat provider key must error, not fall through to a URL-less config")
	}
}

// End-to-end through a real bifrost instance: the derived provider key must
// make bifrost lazily create an Anthropic-based custom provider pointed at
// the credential's endpoint, and the /v1/messages raw-forward path must
// deliver the inbound body there unchanged and hand back the server's native
// response bytes. This is the proof the registry → GetConfigForProvider →
// provider-creation chain actually holds together, which the config-shape
// tests above cannot give.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
func TestDispatch_MessagesReachesAnthropicCompatEndpoint(t *testing.T) {
	const inboundBody = `{"model":"claude-sonnet-5","max_tokens":32,"messages":[{"role":"user","content":"hi"}]}`
	const upstreamResponse = `{"id":"msg_test","type":"message","role":"assistant","model":"claude-sonnet-5","content":[{"type":"text","text":"hello from vllm"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":5}}`

	var captured struct {
		path   string
		apiKey string
		body   string
		hit    bool
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured.hit = true
		captured.path = r.URL.Path
		captured.apiKey = r.Header.Get("x-api-key")
		captured.body = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(upstreamResponse))
	}))
	defer srv.Close()

	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	if err != nil {
		t.Fatalf("NewBifrostRouter: %v", err)
	}
	defer router.Close()

	cred := domain.Credential{
		ID:         "mp-ant-compat",
		ProviderID: domain.ProviderAnthropic,
		APIKey:     "sk-local",
		Extra:      map[string]string{"base_url": srv.URL},
	}
	resp, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeMessages,
		Model: "claude-sonnet-5",
		Body:  []byte(inboundBody),
	}, cred)
	if err != nil {
		t.Fatalf("Dispatch returned error: %v", err)
	}

	if !captured.hit {
		t.Fatal("test server was never hit — the base URL override did not take effect")
	}
	if captured.path != "/v1/messages" {
		t.Fatalf("upstream path = %q, want /v1/messages", captured.path)
	}
	if captured.apiKey != "sk-local" {
		t.Fatalf("upstream x-api-key = %q, want the credential's API key", captured.apiKey)
	}
	if captured.body != inboundBody {
		t.Fatalf("upstream body was not forwarded unchanged:\n got: %s\nwant: %s", captured.body, inboundBody)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if string(resp.Body) != upstreamResponse {
		t.Fatalf("response body was not the server's native bytes:\n got: %s\nwant: %s", resp.Body, upstreamResponse)
	}
}

// Streaming sibling of the dispatch test above, keyless: DispatchStream
// must reach the configured endpoint's /v1/messages, send no x-api-key
// (unauthenticated self-hosted server), and forward the server's native
// Anthropic SSE frames byte-for-byte — Anthropic SDK clients Zod-validate
// every event and reject any reshaped chunk.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
func TestDispatchStream_MessagesStreamsFromKeylessAnthropicCompatEndpoint(t *testing.T) {
	const sseBody = "event: message_start\n" +
		`data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"qwen3-14b","usage":{"input_tokens":3,"output_tokens":0}}}` + "\n\n" +
		"event: content_block_delta\n" +
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"},"index":0}` + "\n\n" +
		"event: message_stop\n" +
		`data: {"type":"message_stop"}` + "\n\n"

	var captured struct {
		path      string
		apiKey    string
		hasAPIKey bool
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.path = r.URL.Path
		captured.apiKey = r.Header.Get("x-api-key")
		_, captured.hasAPIKey = r.Header["X-Api-Key"]
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	if err != nil {
		t.Fatalf("NewBifrostRouter: %v", err)
	}
	defer router.Close()

	iter, err := router.DispatchStream(context.Background(), &domain.Request{
		Type:  domain.RequestTypeMessages,
		Model: "claude-sonnet-5",
		Body:  []byte(`{"model":"claude-sonnet-5","max_tokens":16,"stream":true,"messages":[{"role":"user","content":"hi"}]}`),
	}, domain.Credential{
		ID:         "mp-ant-keyless",
		ProviderID: domain.ProviderAnthropic,
		// No APIKey: unauthenticated self-hosted server.
		Extra: map[string]string{"base_url": srv.URL},
	})
	if err != nil {
		t.Fatalf("DispatchStream returned error: %v", err)
	}
	defer func() { _ = iter.Close() }()

	var received []byte
	for iter.Next(context.Background()) {
		received = append(received, iter.Chunk()...)
	}
	if iterErr := iter.Err(); iterErr != nil {
		t.Fatalf("stream iterator error: %v", iterErr)
	}

	if captured.path != "/v1/messages" {
		t.Fatalf("upstream path = %q, want /v1/messages", captured.path)
	}
	if captured.hasAPIKey || captured.apiKey != "" {
		t.Fatalf("x-api-key = %q sent for a keyless credential, want no header", captured.apiKey)
	}
	if string(received) != sseBody {
		t.Fatalf("SSE frames were not forwarded byte-for-byte:\n got: %q\nwant: %q", received, sseBody)
	}
}

// The derived custom provider key reaches credentialToBifrostKey as-is; it
// must take the plain-API-key path (x-api-key header), not grow a
// VLLMKeyConfig — the endpoint URL rides on the provider config, not the key.
func TestCredentialToBifrostKey_AnthropicCompatUsesPlainAPIKey(t *testing.T) {
	cred := domain.Credential{
		ID:         "mp-ant",
		ProviderID: domain.ProviderAnthropic,
		APIKey:     "sk-ant",
		Extra:      map[string]string{"base_url": "http://vllm:8000"},
	}
	key := credentialToBifrostKey(cred, mapProvider(cred))

	if key.Value.Val != "sk-ant" {
		t.Fatalf("key.Value = %q, want the credential's API key", key.Value.Val)
	}
	if key.VLLMKeyConfig != nil {
		t.Fatal("VLLMKeyConfig must stay nil: the endpoint rides on the provider config, not the key")
	}
}
