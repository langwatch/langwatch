package litellmparams

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Credential maps the inline credentials into the one domain.Credential the
// BifrostRouter understands. Only the active provider's slot is read.
func (ic InlineCredentials) Credential() (domain.Credential, error) {
	switch ic.Provider {
	case "openai":
		return apiKeyCred(domain.ProviderOpenAI, ic.OpenAI), nil
	case "anthropic":
		return apiKeyCred(domain.ProviderAnthropic, ic.Anthropic), nil
	case "azure":
		return azureCred(ic.Azure), nil
	case "bedrock":
		return bedrockCred(ic.Bedrock), nil
	case "vertex_ai", "vertex":
		return vertexCred(ic.VertexAI), nil
	case "gemini":
		return apiKeyCred(domain.ProviderGemini, ic.Gemini), nil
	case "xai", "groq", "cerebras", "deepseek":
		// Plain api-key providers share the Generic slot. DeepSeek routes
		// through the gateway's openai-compat (vLLM) path with its public
		// endpoint as the default base URL; the rest are Bifrost-native.
		return apiKeyCred(domain.ProviderID(ic.Provider), ic.Generic), nil
	case "custom":
		// Custom routes through Bifrost's openai-compat adapter — same
		// credential layout as OpenAI but a different ProviderID so the
		// gateway-side custom-→-openai mapping logic stays applicable.
		return apiKeyCred(domain.ProviderOpenAI, ic.Custom), nil
	case "":
		return domain.Credential{}, errors.New("litellmparams: provider is required in inline credentials")
	default:
		return domain.Credential{}, fmt.Errorf("litellmparams: unsupported provider %q", ic.Provider)
	}
}

// inlineCredentialID is the synthetic credential id we put on every
// Credential we build from inline credentials. Bifrost's account
// resolver requires a non-empty id (see services/aigateway/adapters/
// providers/bifrost.go:486). nlpgo only ever sends one credential per
// call so a constant suffices; aigateway's HTTP layer assigns real
// ULIDs because it picks among many configured credentials per VK.
func inlineCredentialID(provider domain.ProviderID) string {
	return "nlpgo-inline-" + string(provider)
}

// apiKeyCred builds the Credential for providers that authenticate with
// a plain api_key (plus optional pass-through extras like api_base).
func apiKeyCred(provider domain.ProviderID, m map[string]string) domain.Credential {
	return domain.Credential{
		ID:         inlineCredentialID(provider),
		ProviderID: provider,
		APIKey:     m["api_key"],
		Extra:      stringExtras(m, "api_key"),
	}
}

func azureCred(m map[string]any) domain.Credential {
	apiKey, _ := m["api_key"].(string)
	extra := make(map[string]string, len(m))
	// Bifrost's Azure key reader expects Extra["endpoint"] and
	// Extra["api_version"]. The Studio-side litellm_params shape names
	// the endpoint "api_base" — translate so Bifrost picks it up. Any
	// unrecognized fields are still passed through stringified for
	// forward compatibility (e.g. extra_headers, use_azure_gateway).
	for k, v := range m {
		if k == "api_key" {
			continue
		}
		dst := k
		if k == "api_base" {
			dst = "endpoint"
		}
		if value, ok := azureExtraValue(v); ok {
			extra[dst] = value
		}
	}
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderAzure),
		ProviderID: domain.ProviderAzure,
		APIKey:     apiKey,
		Extra:      extra,
	}
}

// azureExtraValue stringifies one Azure field: JSON for objects and arrays,
// %v for scalars (so a bool reads "true"/"false").
func azureExtraValue(v any) (string, bool) {
	switch x := v.(type) {
	case string:
		return x, true
	case map[string]any, []any:
		b, err := json.Marshal(x)
		return string(b), err == nil
	default:
		return fmt.Sprintf("%v", x), true
	}
}

func bedrockCred(m map[string]string) domain.Credential {
	// Bifrost's Bedrock key reader expects Extra keys "access_key",
	// "secret_key", "session_token", "region". The Studio-side
	// litellm_params names them aws_access_key_id / aws_secret_access_key
	// / aws_session_token / aws_region_name. Translate at the boundary.
	extra := map[string]string{}
	if v := m["aws_access_key_id"]; v != "" {
		extra["access_key"] = v
	}
	if v := m["aws_secret_access_key"]; v != "" {
		extra["secret_key"] = v
	}
	if v := m["aws_session_token"]; v != "" {
		extra["session_token"] = v
	}
	if v := m["aws_region_name"]; v != "" {
		extra["region"] = v
	}
	if v := m["aws_bedrock_runtime_endpoint"]; v != "" {
		extra["bedrock_runtime_endpoint"] = v
	}
	if v := m["api_base"]; v != "" {
		extra["base_url"] = v // a stand-in runtime host such as llmsim; the gateway checks its allowlist
	}
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderBedrock),
		ProviderID: domain.ProviderBedrock,
		APIKey:     m["aws_access_key_id"],
		Extra:      extra,
	}
}

func vertexCred(m map[string]string) domain.Credential {
	// Bifrost's Vertex key reader expects Extra["project_id"],
	// Extra["region"], and APIKey carrying the SA JSON. The
	// litellm_params names the SA JSON "vertex_credentials" and uses
	// vertex_project / vertex_location for routing.
	extra := map[string]string{}
	if v := m["vertex_project"]; v != "" {
		extra["project_id"] = v
	}
	if v := m["vertex_location"]; v != "" {
		extra["region"] = v
	}
	if v := m["api_base"]; v != "" {
		extra["base_url"] = v // a stand-in host such as llmsim; the gateway's Vertex override
	}
	return domain.Credential{
		ID:         inlineCredentialID(domain.ProviderVertex),
		ProviderID: domain.ProviderVertex,
		APIKey:     m["vertex_credentials"],
		Extra:      extra,
	}
}

// stringExtras copies a string-map dropping the named keys. Used to
// place provider-specific non-key fields (api_base, api_version, etc.)
// into Credential.Extra without dragging the API key in twice.
func stringExtras(m map[string]string, drop ...string) map[string]string {
	if len(m) == 0 {
		return nil
	}
	out := make(map[string]string, len(m))
	skip := make(map[string]struct{}, len(drop))
	for _, d := range drop {
		skip[d] = struct{}{}
	}
	for k, v := range m {
		if _, found := skip[k]; found {
			continue
		}
		if v == "" {
			continue
		}
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
