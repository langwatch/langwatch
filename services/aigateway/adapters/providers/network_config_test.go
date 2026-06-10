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
	assert.Equal(t, 14*60*time.Second, newVoyageClient().Timeout)
}
