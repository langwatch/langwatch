package controlplane

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The control-plane/VK path materializes provider slots from the bundle wire.
// A ModelProvider with no deploymentMapping ships no `deployment_map` key at
// all, and an empty mapping ships `{}` — so on this path the wire alone can
// never hand Azure / Bedrock / Vertex the deployment name Bifrost demands.
// That is the precondition behind the dispatch failure; these cases pin it,
// and guard the two properties a fix must not break (a configured map survives
// verbatim, and non-mapped providers stay nil).
//
// The dispatch-side consequence lives in
// services/aigateway/adapters/providers/azure_deployment_selfmap_test.go.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature
func TestProviderSlotToCredential_DeploymentMap(t *testing.T) {
	cases := []struct {
		name string
		wire string
		want map[string]string
	}{
		{
			// AC1 precondition: the shape production sends for an Azure
			// provider whose models carry no explicit deployment mapping.
			name: "azure slot with no deployment_map key yields a nil map",
			wire: `{"id":"cred-azure","type":"azure","credentials":{"api_key":"az-key","endpoint":"https://acme.openai.azure.com","api_version":"2024-10-21"}}`,
			want: nil,
		},
		{
			// AC2: the `{}` slot takes the same branch as the absent slot at
			// config_wire.go:404-406 (len() == 0 for both).
			name: "azure slot with an empty deployment_map yields a nil map",
			wire: `{"id":"cred-azure","type":"azure","credentials":{"api_key":"az-key","endpoint":"https://acme.openai.azure.com"},"deployment_map":{}}`,
			want: nil,
		},
		{
			// AC7: a configured mapping reaches the credential verbatim.
			name: "azure slot with a configured deployment_map is carried verbatim",
			wire: `{"id":"cred-azure","type":"azure","credentials":{"api_key":"az-key","endpoint":"https://acme.openai.azure.com"},"deployment_map":{"gpt-4.1":"my-custom-deployment","gpt-5.3-mini":"prod-mini"}}`,
			want: map[string]string{"gpt-4.1": "my-custom-deployment", "gpt-5.3-mini": "prod-mini"},
		},
		{
			// AC9 precondition: bedrock is deployment-routed too and has the
			// same hole on this path.
			name: "bedrock slot with no deployment_map key yields a nil map",
			wire: `{"id":"cred-bedrock","type":"bedrock","credentials":{"access_key":"AK","secret_key":"SK","region":"us-east-1"}}`,
			want: nil,
		},
		{
			// AC9 precondition: vertex, same.
			name: "vertex slot with no deployment_map key yields a nil map",
			wire: `{"id":"cred-vertex","type":"vertex","credentials":{"project_id":"proj","region":"us-central1"}}`,
			want: nil,
		},
		{
			// AC10: non-mapped providers must stay nil — nothing may
			// fabricate a deployment map for them.
			name: "openai slot yields a nil map",
			wire: `{"id":"cred-openai","type":"openai","credentials":{"api_key":"sk-test"}}`,
			want: nil,
		},
		{
			name: "anthropic slot yields a nil map",
			wire: `{"id":"cred-anthropic","type":"anthropic","credentials":{"api_key":"sk-ant-test"}}`,
			want: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var slot providerSlotWire
			require.NoError(t, json.Unmarshal([]byte(tc.wire), &slot), "wire fixture must decode")

			cred := providerSlotToCredential(slot)

			if tc.want == nil {
				assert.Nil(t, cred.DeploymentMap,
					"the wire alone cannot supply a deployment for this slot; got %#v", cred.DeploymentMap)
				return
			}
			assert.Equal(t, tc.want, cred.DeploymentMap)
		})
	}
}

// AC2, stated as the equivalence it actually claims: an absent `deployment_map`
// and an empty one are indistinguishable downstream, so a fix that only handles
// one of them fixes half the fleet.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature
func TestProviderSlotToCredential_AbsentAndEmptyDeploymentMapAreIndistinguishable(t *testing.T) {
	decode := func(t *testing.T, wire string) domain.Credential {
		t.Helper()
		var slot providerSlotWire
		require.NoError(t, json.Unmarshal([]byte(wire), &slot))
		return providerSlotToCredential(slot)
	}

	absent := decode(t, `{"id":"cred-azure","type":"azure","credentials":{"api_key":"az-key","endpoint":"https://acme.openai.azure.com","api_version":"2024-10-21"}}`)
	empty := decode(t, `{"id":"cred-azure","type":"azure","credentials":{"api_key":"az-key","endpoint":"https://acme.openai.azure.com","api_version":"2024-10-21"},"deployment_map":{}}`)

	assert.Equal(t, absent, empty,
		"absent and empty deployment_map must produce the same credential; a fix that only covers one covers neither in practice")
}
