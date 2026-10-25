package dispatcheradapter

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/litellmparams"
)

// encodeCreds is the same shape llmexecutor's translator emits.
func encodeCreds(t *testing.T, ic litellmparams.InlineCredentials) string {
	t.Helper()
	b, err := json.Marshal(ic)
	if err != nil {
		t.Fatalf("marshal creds: %v", err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func TestCredentialFromHeaders_OpenAI(t *testing.T) {
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
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
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
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
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
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
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
		Provider: "bedrock",
		Bedrock: map[string]string{
			"aws_access_key_id":            "AKIA-TEST",
			"aws_secret_access_key":        "shh-secret",
			"aws_region_name":              "us-east-1",
			"aws_bedrock_runtime_endpoint": "http://vpce-abc.vpce-svc.us-east-1.vpce.amazonaws.com:80",
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
	// Managed-Bedrock customers reach the model only through their PrivateLink
	// VPC endpoint; the gateway's VPCE dispatch reads it from this key. Losing
	// it here silently routes them at the public endpoint and 403s.
	if cred.Extra["bedrock_runtime_endpoint"] != "http://vpce-abc.vpce-svc.us-east-1.vpce.amazonaws.com:80" {
		t.Errorf("runtime endpoint lost: %v", cred.Extra)
	}
}

func TestCredentialFromHeaders_Vertex(t *testing.T) {
	saJSON := `{"type":"service_account","project_id":"acme"}`
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
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
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
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

func TestCredentialFromHeaders_GenericAPIKeyProviders(t *testing.T) {
	// xai/groq/cerebras/deepseek/doubleword share the Generic slot; Provider
	// disambiguates and maps 1:1 onto the domain provider id.
	for _, provider := range []string{"xai", "groq", "cerebras", "deepseek", "doubleword"} {
		t.Run(provider, func(t *testing.T) {
			hdr := encodeCreds(t, litellmparams.InlineCredentials{
				Provider: provider,
				Generic:  map[string]string{"api_key": "gen-key"},
			})
			cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
			if err != nil {
				t.Fatalf("err: %v", err)
			}
			if cred.ProviderID != domain.ProviderID(provider) {
				t.Errorf("ProviderID: %q, want %q", cred.ProviderID, provider)
			}
			if cred.APIKey != "gen-key" {
				t.Errorf("APIKey: %q", cred.APIKey)
			}
		})
	}
}

func TestCredentialFromHeaders_Custom(t *testing.T) {
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
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
	hdr := encodeCreds(t, litellmparams.InlineCredentials{Provider: ""})
	_, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err == nil {
		t.Fatalf("expected provider-required error")
	}
}

func TestCredentialFromHeaders_UnsupportedProvider(t *testing.T) {
	hdr := encodeCreds(t, litellmparams.InlineCredentials{Provider: "cohere"})
	_, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected unsupported-provider error, got %v", err)
	}
}

func TestWithDeploymentSelfMap_SelfMapsByDefault(t *testing.T) {
	cred := domain.Credential{ProviderID: domain.ProviderAzure}
	cred = domain.WithDeploymentSelfMap(cred, "gpt-5-mini")
	if got := cred.DeploymentMap["gpt-5-mini"]; got != "gpt-5-mini" {
		t.Errorf("expected self-map, got %q", got)
	}
}

func TestWithDeploymentSelfMap_HonorsExplicitDeployment(t *testing.T) {
	// When the model id differs from the Azure deployment name, the control
	// plane forwards the real deployment as Extra["deployment"]; the model
	// id must map to it rather than to itself.
	cred := domain.Credential{
		ProviderID: domain.ProviderAzure,
		Extra:      map[string]string{"deployment": "my-gpt5-deployment"},
	}
	cred = domain.WithDeploymentSelfMap(cred, "gpt-5.4")
	if got := cred.DeploymentMap["gpt-5.4"]; got != "my-gpt5-deployment" {
		t.Errorf("expected explicit deployment, got %q", got)
	}
}

func TestWithDeploymentSelfMap_IgnoresNonMappedProviders(t *testing.T) {
	cred := domain.Credential{ProviderID: domain.ProviderOpenAI}
	cred = domain.WithDeploymentSelfMap(cred, "gpt-5-mini")
	if cred.DeploymentMap != nil {
		t.Errorf("expected no deployment map for OpenAI, got %v", cred.DeploymentMap)
	}
}

// @scenario "A Gemini or Vertex provider with a base URL reaches that host instead of Google's"
func TestCredentialFromHeaders_VertexBaseURL(t *testing.T) {
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
		Provider: "vertex_ai",
		VertexAI: map[string]string{"vertex_project": "p1", "vertex_location": "us-central1", "api_base": "http://127.0.0.1:21651"},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.Extra["base_url"] != "http://127.0.0.1:21651" {
		t.Errorf("api_base should reach the gateway as base_url: %v", cred.Extra)
	}
}

// @scenario "A Bedrock provider whose runtime host is on the customer-endpoint allowlist reaches that host"
func TestCredentialFromHeaders_BedrockBaseURL(t *testing.T) {
	hdr := encodeCreds(t, litellmparams.InlineCredentials{
		Provider: "bedrock",
		Bedrock:  map[string]string{"aws_access_key_id": "k", "aws_secret_access_key": "s", "aws_region_name": "us-east-1", "api_base": "http://127.0.0.1:21651"},
	})
	cred, err := credentialFromHeaders(map[string]string{headerInlineCredentials: hdr})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if cred.Extra["base_url"] != "http://127.0.0.1:21651" {
		t.Errorf("api_base should reach the gateway as base_url: %v", cred.Extra)
	}
}
