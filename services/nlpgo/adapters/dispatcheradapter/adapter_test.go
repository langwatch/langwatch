package dispatcheradapter

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// encodeCreds is the same shape llmexecutor's translator emits.
func encodeCreds(t *testing.T, ic inlineCreds) string {
	t.Helper()
	b, err := json.Marshal(ic)
	if err != nil {
		t.Fatalf("marshal creds: %v", err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func TestCredentialFromHeaders_OpenAI(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{
		Provider: "openai",
		OpenAI: map[string]string{
			"api_key":      "sk-test",
			"api_base":     "https://api.openai.com/v1",
			"organization": "org-acme",
		},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.ProviderID != domain.ProviderOpenAI {
		t.Errorf("ProviderID: got %q want %q", cred.ProviderID, domain.ProviderOpenAI)
	}
	if cred.APIKey != "sk-test" {
		t.Errorf("APIKey: got %q want sk-test", cred.APIKey)
	}
	if cred.Extra["api_base"] != "https://api.openai.com/v1" {
		t.Errorf("api_base lost: %v", cred.Extra)
	}
	if _, present := cred.Extra["api_key"]; present {
		t.Errorf("api_key should not duplicate into Extra")
	}
}

func TestCredentialFromHeaders_Anthropic(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{
		Provider: "anthropic",
		Anthropic: map[string]string{
			"api_key":  "sk-ant-test",
			"api_base": "https://api.anthropic.com",
		},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.ProviderID != domain.ProviderAnthropic {
		t.Errorf("ProviderID: got %q", cred.ProviderID)
	}
	if cred.APIKey != "sk-ant-test" {
		t.Errorf("APIKey: got %q", cred.APIKey)
	}
}

func TestCredentialFromHeaders_Azure(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{
		Provider: "azure",
		Azure: map[string]any{
			"api_key":           "az-secret",
			"api_base":          "https://contoso.openai.azure.com",
			"api_version":       "2024-06-01",
			"use_azure_gateway": true,
			"extra_headers":     map[string]any{"X-Subscription": "ent-1"},
		},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.ProviderID != domain.ProviderAzure {
		t.Errorf("ProviderID: %q", cred.ProviderID)
	}
	if cred.APIKey != "az-secret" {
		t.Errorf("APIKey: %q", cred.APIKey)
	}
	if cred.Extra["api_version"] != "2024-06-01" {
		t.Errorf("api_version lost: %v", cred.Extra)
	}
	if cred.Extra["use_azure_gateway"] != "true" {
		t.Errorf("use_azure_gateway not stringified: %v", cred.Extra)
	}
	if !strings.Contains(cred.Extra["extra_headers"], "X-Subscription") {
		t.Errorf("extra_headers JSON not preserved: %v", cred.Extra)
	}
}

func TestCredentialFromHeaders_Bedrock(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{
		Provider: "bedrock",
		Bedrock: map[string]string{
			"aws_access_key_id":     "AKIA-TEST",
			"aws_secret_access_key": "shh-secret",
			"aws_region_name":       "us-east-1",
		},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.ProviderID != domain.ProviderBedrock {
		t.Errorf("ProviderID: %q", cred.ProviderID)
	}
	if cred.APIKey != "AKIA-TEST" {
		t.Errorf("APIKey: %q", cred.APIKey)
	}
	// Adapter translates aws_* litellm names → Bifrost-canonical names.
	if cred.Extra["secret_key"] != "shh-secret" {
		t.Errorf("secret key lost: %v", cred.Extra)
	}
	if cred.Extra["region"] != "us-east-1" {
		t.Errorf("region lost: %v", cred.Extra)
	}
}

func TestCredentialFromHeaders_Vertex(t *testing.T) {
	saJSON := `{"type":"service_account","project_id":"acme"}`
	hdr := encodeCreds(t, inlineCreds{
		Provider: "vertex_ai",
		VertexAI: map[string]string{
			"vertex_credentials": saJSON,
			"vertex_project":     "acme",
			"vertex_location":    "us-central1",
		},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.ProviderID != domain.ProviderVertex {
		t.Errorf("ProviderID: %q", cred.ProviderID)
	}
	if cred.APIKey != saJSON {
		t.Errorf("SA JSON not preserved as APIKey")
	}
	// Adapter translates vertex_* litellm names → Bifrost-canonical names.
	if cred.Extra["region"] != "us-central1" {
		t.Errorf("region (was vertex_location) lost: %v", cred.Extra)
	}
	if cred.Extra["project_id"] != "acme" {
		t.Errorf("project_id (was vertex_project) lost: %v", cred.Extra)
	}
}

func TestCredentialFromHeaders_Gemini(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{
		Provider: "gemini",
		Gemini:   map[string]string{"api_key": "gem-key"},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.ProviderID != domain.ProviderGemini {
		t.Errorf("ProviderID: %q", cred.ProviderID)
	}
	if cred.APIKey != "gem-key" {
		t.Errorf("APIKey: %q", cred.APIKey)
	}
}

func TestCredentialFromHeaders_Custom(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{
		Provider: "custom",
		Custom: map[string]string{
			"api_key":  "cust-key",
			"api_base": "https://together.ai/v1",
		},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	// Custom is mapped to OpenAI provider id so Bifrost dispatches via
	// its OpenAI-compat adapter.
	if cred.ProviderID != domain.ProviderOpenAI {
		t.Errorf("custom should map to ProviderOpenAI, got %q", cred.ProviderID)
	}
	if cred.APIKey != "cust-key" {
		t.Errorf("APIKey: %q", cred.APIKey)
	}
	if cred.Extra["api_base"] != "https://together.ai/v1" {
		t.Errorf("api_base lost: %v", cred.Extra)
	}
}

func TestCredentialFromHeaders_MissingHeader(t *testing.T) {
	_, err := credentialFromHeaders(map[string]string{})
	if err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("expected missing-header error, got %v", err)
	}
}

func TestCredentialFromHeaders_BadBase64(t *testing.T) {
	_, err := credentialFromHeaders(map[string]string{
		headerInlineCredentials: "not-base64-!@#$",
	})
	if err == nil {
		t.Fatalf("expected base64 decode error, got nil")
	}
}

func TestCredentialFromHeaders_BadJSON(t *testing.T) {
	hdr := base64.StdEncoding.EncodeToString([]byte(`{"provider": "openai", broken`))
	_, err := credentialFromHeaders(map[string]string{
		headerInlineCredentials: hdr,
	})
	if err == nil {
		t.Fatalf("expected JSON unmarshal error")
	}
}

func TestCredentialFromHeaders_EmptyProvider(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{Provider: ""})
	_, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err == nil {
		t.Fatalf("expected provider-required error")
	}
}

func TestCredentialFromHeaders_UnsupportedProvider(t *testing.T) {
	hdr := encodeCreds(t, inlineCreds{Provider: "cohere"})
	_, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected unsupported-provider error, got %v", err)
	}
}
