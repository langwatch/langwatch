package providers

import (
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// bifrost v1.5 moved model->deployment mapping off the vendor key configs onto
// Key.Aliases, resolved uniformly via Aliases.Resolve. Azure and Bedrock forward
// cred.DeploymentMap into Key.Aliases in credentialToBifrostKey; Vertex routes on
// deployment the same way and must forward it too — the gap #7778's dispatch-path
// fix did not close, and the one the review threads asked for.
//
// The dispatch-path self-map itself now lives on main via PR #7778
// (specs/ai-gateway/azure-endpoint-from-api-base.feature). This file covers only
// the key-alias forwarding contract: for a slot with no wire deployment_map the
// model->model self-map must reach the key aliases, and an explicit map must be
// forwarded verbatim — for every deployment-mapped provider, Vertex included.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// AC9: Azure, Bedrock and Vertex all forward the deployment map into Key.Aliases.
//
// @scenario "Every deployment-mapped provider forwards its deployment map to the key aliases"
func TestCredentialToBifrostKey_DeploymentMapReachesEveryMappedProvider(t *testing.T) {
	const model = "gpt-5.3-mini"

	providers := []struct {
		name       string
		providerID domain.ProviderID
		provider   bfschemas.ModelProvider
		extra      map[string]string
	}{
		{"azure", domain.ProviderAzure, bfschemas.Azure, map[string]string{"endpoint": "https://acme.openai.azure.com"}},
		{"bedrock", domain.ProviderBedrock, bfschemas.Bedrock, map[string]string{"access_key": "AK", "secret_key": "SK", "region": "us-east-1"}},
		{"vertex", domain.ProviderVertex, bfschemas.Vertex, map[string]string{"project_id": "proj", "region": "us-central1"}},
	}

	for _, p := range providers {
		t.Run(p.name, func(t *testing.T) {
			t.Run("self-map from a nil deployment map reaches the aliases", func(t *testing.T) {
				cred := domain.Credential{ID: "cred-" + p.name, ProviderID: p.providerID, APIKey: "k", Extra: p.extra}
				require.Nil(t, cred.DeploymentMap, "fixture precondition: the wire supplies no deployment map")

				cred = domain.WithDeploymentSelfMap(cred, model)
				key := credentialToBifrostKey(cred, p.provider, nil)

				assert.Equal(t, model, map[string]string(key.Aliases)[model],
					"%s must forward the self-mapped deployment (model id) into the key aliases", p.name)
			})

			t.Run("explicit deployment map is forwarded verbatim", func(t *testing.T) {
				want := map[string]string{model: "custom-deployment"}
				cred := domain.Credential{ID: "cred-" + p.name, ProviderID: p.providerID, APIKey: "k", Extra: p.extra, DeploymentMap: want}

				// WithDeploymentSelfMap leaves an already-populated mapping alone.
				cred = domain.WithDeploymentSelfMap(cred, model)
				key := credentialToBifrostKey(cred, p.provider, nil)

				assert.Equal(t, want, map[string]string(key.Aliases),
					"%s must forward an explicit deployment map into the key aliases verbatim", p.name)
			})
		})
	}
}
