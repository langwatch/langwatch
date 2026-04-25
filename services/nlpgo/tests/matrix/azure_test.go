//go:build live_azure

package matrix

import "testing"

// TestAzure_SimpleCompletion verifies Azure OpenAI through the inline-
// credentials path. Azure routing requires api_base + api_version + the
// deployment name in the model id (azure/<deployment>).
//
// Required env:
//   - AZURE_OPENAI_API_KEY
//   - AZURE_OPENAI_ENDPOINT (api_base, e.g. https://acme.openai.azure.com)
//   - AZURE_OPENAI_API_VERSION (defaults to 2024-05-01-preview)
//   - AZURE_OPENAI_DEPLOYMENT (full deployment name)
func TestAzure_SimpleCompletion(t *testing.T) {
	mc := loadContext(t)
	apiKey := requireEnv(t, "AZURE_OPENAI_API_KEY")
	endpoint := requireEnv(t, "AZURE_OPENAI_ENDPOINT")
	deployment := requireEnv(t, "AZURE_OPENAI_DEPLOYMENT")
	version := envOrDefault("AZURE_OPENAI_API_VERSION", "2024-05-01-preview")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, "azure/"+deployment, map[string]any{
		"api_key":     apiKey,
		"api_base":    endpoint,
		"api_version": version,
	})
	assertContent(t, resp)
}
