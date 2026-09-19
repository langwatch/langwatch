package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Azure, Bedrock and Vertex all route on a deployment name. WithDeploymentSelfMap
// resolves one for the providers that need it and must leave every other provider
// exactly as it found it — a nil map stays nil, so nothing downstream can mistake
// a plain provider for a deployment-routed one.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// AC10: the self-map must leave providers that do not route on deployment exactly
// as it found them — a nil map stays nil. The scenario's other half, that no Azure
// key configuration is fabricated for them, is held one layer out in
// adapters/providers/azure_deployment_selfmap_test.go.
//
// @scenario "Providers without deployments are left untouched"
func TestWithDeploymentSelfMap_NonMappedProvidersAreUntouched(t *testing.T) {
	for _, providerID := range []ProviderID{
		ProviderOpenAI,
		ProviderAnthropic,
		ProviderGemini,
		ProviderCustom,
	} {
		t.Run(string(providerID), func(t *testing.T) {
			cred := Credential{ID: "cred-1", ProviderID: providerID, APIKey: "sk-test"}

			got := WithDeploymentSelfMap(cred, "gpt-5.3-mini")

			assert.Nil(t, got.DeploymentMap, "%s does not route on deployment", providerID)
			assert.Equal(t, cred, got)
		})
	}
}
