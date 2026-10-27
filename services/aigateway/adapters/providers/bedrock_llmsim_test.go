package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/sims/llmsim"
)

func bedrockSimCred(endpoint string) domain.Credential {
	return domain.Credential{
		ID:         "mp-bedrock",
		ProviderID: domain.ProviderBedrock,
		APIKey:     "AKIDLLMSIM",
		Extra: map[string]string{
			"access_key": "AKIDLLMSIM", "secret_key": "not-a-secret", "region": "us-east-1",
			"base_url": endpoint,
		},
	}
}

func bedrockChat() *domain.Request {
	return &domain.Request{
		Type:     domain.RequestTypeChat,
		Model:    "anthropic.claude-3-5-sonnet-20240620-v1:0",
		Resolved: &domain.ResolvedModel{ModelID: "anthropic.claude-3-5-sonnet-20240620-v1:0", ProviderID: domain.ProviderBedrock},
		Body:     []byte(`{"model":"anthropic.claude-3-5-sonnet-20240620-v1:0","messages":[{"role":"user","content":"hello"}]}`),
	}
}

// @scenario "A Bedrock provider whose runtime host is on the customer-endpoint allowlist reaches that host"
func TestDispatchBedrockReachesAnAllowlistedRuntimeHost(t *testing.T) {
	sim := httptest.NewServer(llmsim.NewServer(llmsim.Config{Stack: "test"}).Handler())
	defer sim.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10, AllowedEndpointHosts: []string{"127.0.0.1"}})
	if err != nil {
		t.Fatalf("NewBifrostRouter: %v", err)
	}
	defer router.Close()

	resp, err := router.Dispatch(context.Background(), bedrockChat(), bedrockSimCred(sim.URL))
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(resp.Body), `"content"`) {
		t.Fatalf("status %d body %s", resp.StatusCode, resp.Body)
	}
	calls, err := http.Get(sim.URL + "/_sim/api/calls")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = calls.Body.Close() }()
	raw, _ := io.ReadAll(calls.Body)
	var listed struct {
		Calls []struct {
			Path    string `json:"path"`
			Dialect string `json:"dialect"`
		} `json:"calls"`
	}
	_ = json.Unmarshal(raw, &listed)
	if len(listed.Calls) == 0 || listed.Calls[0].Dialect != "bedrock" || !strings.HasSuffix(listed.Calls[0].Path, "/converse") {
		t.Fatalf("llmsim should have answered a Bedrock Converse call, got %s", raw)
	}
}

// @scenario "A Bedrock provider whose runtime host is on the customer-endpoint allowlist reaches that host"
func TestBedrockRuntimeHostOffTheAllowlistIsStillRefused(t *testing.T) {
	allow := newCustomerEndpointPolicy(true, false, []string{"127.0.0.1"})
	if err := validateBedrockEndpoint("http://127.0.0.1:21651", allow); err != nil {
		t.Fatalf("an allowlisted host is accepted: %v", err)
	}
	for _, refused := range []string{"http://localhost:21651", "http://127.0.0.2:21651", "http://10.0.0.5", "http://169.254.169.254"} {
		if err := validateBedrockEndpoint(refused, allow); err == nil {
			t.Errorf("%s is not on the allowlist and must stay refused", refused)
		}
	}
	if err := validateBedrockEndpoint("http://127.0.0.1:21651", customerEndpointPolicy{}); err == nil {
		t.Fatal("with no allowlist a loopback runtime host is refused, as before")
	}
	if err := validateBedrockEndpoint("https://bedrock-runtime.us-east-1.amazonaws.com", allow); err != nil {
		t.Fatalf("public Bedrock stays allowed: %v", err)
	}
}
