package controlplane

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Spec: specs/self-hosting/connected-services/managed-models-provider.feature
//
// The connect_services claim is what tells a license credential apart from a
// virtual key at dispatch. Absent has to stay nil: read as an empty list, every
// ordinary key would look like a license entitled to nothing.

func TestConnectServicesClaimIsCarriedOntoTheBundle(t *testing.T) {
	bundle := claimsToBundle(extractClaims(map[string]any{
		"vk_id":            "vk-connect-1",
		"org_id":           "org-customer-1",
		"connect_services": []any{"instant_evals", "managed_models"},
	}))

	require.True(t, bundle.LicenseCredential())
	assert.Equal(t, []string{"instant_evals", "managed_models"}, bundle.ConnectServices)
	assert.True(t, bundle.EntitledToConnectService(domain.ConnectServiceManagedModels))
}

func TestALicenseEntitledToNothingStillReadsAsALicense(t *testing.T) {
	bundle := claimsToBundle(extractClaims(map[string]any{
		"vk_id":            "vk-connect-1",
		"connect_services": []any{},
	}))

	assert.True(t, bundle.LicenseCredential())
	assert.False(t, bundle.EntitledToConnectService(domain.ConnectServiceManagedModels))
}

func TestAVirtualKeyCarriesNoServicesClaim(t *testing.T) {
	bundle := claimsToBundle(extractClaims(map[string]any{"vk_id": "vk-1"}))

	assert.False(t, bundle.LicenseCredential())
	assert.Nil(t, bundle.ConnectServices)
}

func TestALangWatchProviderSlotCarriesTheLicenseAndTheInstance(t *testing.T) {
	var wire configWire
	require.NoError(t, json.Unmarshal([]byte(`{
		"providers": [{
			"id": "connect-langwatch",
			"type": "langwatch",
			"credentials": {"api_key": "lwl_token", "instance_id": "org-install-1"},
			"base_url": "https://gateway.langwatch.ai/v1"
		}]
	}`), &wire))

	cred := wire.toDomain().Credentials[0]

	assert.Equal(t, domain.ProviderLangWatch, cred.ProviderID)
	assert.Equal(t, "lwl_token", cred.APIKey)
	assert.Equal(t, "org-install-1", cred.Extra["instance_id"])
	assert.Equal(t, "https://gateway.langwatch.ai/v1", cred.Extra["base_url"])
}
