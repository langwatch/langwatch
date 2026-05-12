package gatewayproxy_test

import (
	"errors"
	"net/http"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/gatewayproxy"
)

func mkHeader(kv ...string) http.Header {
	h := http.Header{}
	for i := 0; i+1 < len(kv); i += 2 {
		h.Set(kv[i], kv[i+1])
	}
	return h
}

func TestParseCredentialFromHeaders_OpenAI(t *testing.T) {
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "openai/gpt-5-mini",
		"x-litellm-api_key", "sk-test-123",
		"x-litellm-organization", "org-xyz",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderOpenAI {
		t.Errorf("ProviderID = %q, want openai", cred.ProviderID)
	}
	if cred.APIKey != "sk-test-123" {
		t.Errorf("APIKey = %q", cred.APIKey)
	}
	if cred.Extra["organization"] != "org-xyz" {
		t.Errorf("organization = %q", cred.Extra["organization"])
	}
	if cred.ID == "" {
		t.Errorf("ID should be non-empty")
	}
}

func TestParseCredentialFromHeaders_Anthropic(t *testing.T) {
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "anthropic/claude-sonnet-4-20250514",
		"x-litellm-api_key", "sk-ant-test",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderAnthropic {
		t.Errorf("ProviderID = %q, want anthropic", cred.ProviderID)
	}
	if cred.APIKey != "sk-ant-test" {
		t.Errorf("APIKey = %q", cred.APIKey)
	}
}

func TestParseCredentialFromHeaders_Azure_PicksUpAllKnobs(t *testing.T) {
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "azure/my-deployment",
		"x-litellm-api_key", "azk-secret",
		"x-litellm-api_base", "https://acme.openai.azure.com",
		"x-litellm-api_version", "2024-05-01-preview",
		"x-litellm-extra_headers", `{"X-Internal-Tag":"acme"}`,
		"x-litellm-use_azure_gateway", "true",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderAzure {
		t.Errorf("ProviderID = %q, want azure", cred.ProviderID)
	}
	if cred.APIKey != "azk-secret" {
		t.Errorf("APIKey = %q", cred.APIKey)
	}
	wants := map[string]string{
		"api_base":          "https://acme.openai.azure.com",
		"api_version":       "2024-05-01-preview",
		"extra_headers":     `{"X-Internal-Tag":"acme"}`,
		"use_azure_gateway": "true",
	}
	for k, v := range wants {
		if cred.Extra[k] != v {
			t.Errorf("Extra[%q] = %q, want %q", k, cred.Extra[k], v)
		}
	}
}

func TestParseCredentialFromHeaders_Bedrock_NoApiKeyButAWSExtras(t *testing.T) {
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "bedrock/anthropic.claude-3-sonnet-20240229-v1:0",
		"x-litellm-aws_access_key_id", "AKIA-x",
		"x-litellm-aws_secret_access_key", "secret-x",
		"x-litellm-aws_session_token", "session-x",
		"x-litellm-aws_region_name", "us-east-1",
		"x-litellm-aws_bedrock_runtime_endpoint", "https://bedrock-runtime.us-east-1.amazonaws.com",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderBedrock {
		t.Errorf("ProviderID = %q, want bedrock", cred.ProviderID)
	}
	if cred.APIKey != "" {
		t.Errorf("Bedrock should not set APIKey, got %q", cred.APIKey)
	}
	wants := map[string]string{
		"aws_access_key_id":            "AKIA-x",
		"aws_secret_access_key":        "secret-x",
		"aws_session_token":            "session-x",
		"aws_region_name":              "us-east-1",
		"aws_bedrock_runtime_endpoint": "https://bedrock-runtime.us-east-1.amazonaws.com",
	}
	for k, v := range wants {
		if cred.Extra[k] != v {
			t.Errorf("Extra[%q] = %q, want %q", k, cred.Extra[k], v)
		}
	}
}

func TestParseCredentialFromHeaders_VertexAI_InlineSAJSON(t *testing.T) {
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "vertex_ai/gemini-2.0-flash",
		"x-litellm-vertex_credentials", `{"type":"service_account","project_id":"acme"}`,
		"x-litellm-vertex_project", "acme-vertex",
		"x-litellm-vertex_location", "us-central1",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderVertex {
		t.Errorf("ProviderID = %q, want vertex", cred.ProviderID)
	}
	if cred.APIKey != "" {
		t.Errorf("Vertex must not set APIKey")
	}
	if cred.Extra["vertex_credentials"] == "" || cred.Extra["vertex_project"] != "acme-vertex" || cred.Extra["vertex_location"] != "us-central1" {
		t.Errorf("Vertex extras missing or wrong: %v", cred.Extra)
	}
}

func TestParseCredentialFromHeaders_Gemini_PlainAPIKey(t *testing.T) {
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "gemini/gemini-2.0-flash",
		"x-litellm-api_key", "AIza-test",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderGemini {
		t.Errorf("ProviderID = %q, want gemini", cred.ProviderID)
	}
	if cred.APIKey != "AIza-test" {
		t.Errorf("APIKey = %q", cred.APIKey)
	}
}

func TestParseCredentialFromHeaders_CustomLLMProviderHeaderTakesPrecedence(t *testing.T) {
	// Some clients send a bare model name + the explicit custom_llm_provider
	// to point the dispatcher at a specific backend. We honor the explicit
	// header even when the model has no provider prefix.
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "claude-sonnet-4-20250514",
		"x-litellm-custom_llm_provider", "anthropic",
		"x-litellm-api_key", "sk-ant-test",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderAnthropic {
		t.Errorf("ProviderID = %q, want anthropic", cred.ProviderID)
	}
}

func TestParseCredentialFromHeaders_MissingProvider_ReturnsTypedError(t *testing.T) {
	_, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		// model has no provider prefix; no custom_llm_provider header
		"x-litellm-model", "gpt-5-mini",
		"x-litellm-api_key", "sk-test",
	))
	if err == nil {
		t.Fatalf("err = nil, want missing-provider error")
	}
	if !errors.Is(err, gatewayproxy.ErrMissingProvider) {
		t.Errorf("err = %v, want ErrMissingProvider", err)
	}
}

func TestParseCredentialFromHeaders_AzureAIAlias(t *testing.T) {
	// "azure_ai" is a TS-side alias for "azure"; both must resolve to ProviderAzure.
	cred, err := gatewayproxy.ParseCredentialFromHeaders(mkHeader(
		"x-litellm-model", "azure_ai/gpt-5-mini",
		"x-litellm-api_key", "k",
		"x-litellm-api_base", "https://acme.openai.azure.com",
		"x-litellm-api_version", "2024-05-01-preview",
	))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if cred.ProviderID != domain.ProviderAzure {
		t.Errorf("ProviderID = %q, want azure", cred.ProviderID)
	}
}

func TestBareModel_StripsProviderPrefix(t *testing.T) {
	cases := map[string]string{
		"openai/gpt-5-mini":                       "gpt-5-mini",
		"anthropic/claude-sonnet-4-20250514":      "claude-sonnet-4-20250514",
		"bedrock/anthropic.claude-3-sonnet-20240229-v1:0": "anthropic.claude-3-sonnet-20240229-v1:0",
		"vertex_ai/gemini-2.0-flash":              "gemini-2.0-flash",
		"no-prefix-here":                          "no-prefix-here",
	}
	for in, want := range cases {
		if got := gatewayproxy.BareModel(in); got != want {
			t.Errorf("BareModel(%q) = %q, want %q", in, got, want)
		}
	}
}
