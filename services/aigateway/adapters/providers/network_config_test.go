package providers

import (
	"testing"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "Upstream requests get a 14 minute timeout for every provider"
func TestGetConfigForProviderSetsFourteenMinuteRequestTimeout(t *testing.T) {
	a := &account{}
	// 14*60 is intentionally an independent literal, not the exported
	// constant: this pins the BEHAVIOR (14 minutes) so a fat-fingered
	// constant fails here instead of self-verifying.
	for _, provider := range []bfschemas.ModelProvider{bfschemas.OpenAI, bfschemas.Anthropic, bfschemas.Bedrock} {
		cfg, err := a.GetConfigForProvider(provider)
		require.NoError(t, err)
		assert.Equal(t, 14*60, cfg.NetworkConfig.DefaultRequestTimeoutInSeconds,
			"provider %s must get the gateway-wide 14m timeout, not bifrost's 30s default", provider)
	}
}

// @scenario "Streaming responses tolerate long gaps between chunks"
func TestGetConfigForProviderAlignsStreamIdleTimeout(t *testing.T) {
	a := &account{}
	cfg, err := a.GetConfigForProvider(bfschemas.OpenAI)
	require.NoError(t, err)
	assert.Equal(t, 14*60, cfg.NetworkConfig.StreamIdleTimeoutInSeconds,
		"per-chunk idle timeout must match the request ceiling; the 60s default kills reasoning-model streams that think before the first token")
	// CheckAndSetDefaults must still fill the knobs we don't pin.
	assert.NotZero(t, cfg.ConcurrencyAndBufferSize.Concurrency)
	assert.NotZero(t, cfg.NetworkConfig.RetryBackoffInitial)
}

// @scenario "Direct embedding requests share the same ceiling"
func TestVoyageClientSharesTimeoutCeiling(t *testing.T) {
	// The contract here is the relationship: the direct Voyage client uses
	// the same ceiling as the routed providers. The absolute 14m value is
	// pinned by the request-timeout tests above with independent literals.
	assert.Equal(t, ProviderRequestTimeoutSeconds*time.Second, newVoyageClient().Timeout)
}
