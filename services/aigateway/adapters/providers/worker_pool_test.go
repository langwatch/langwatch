package providers

import (
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The numbers here are deliberately independent literals rather than the
// package constants: pinning the constant against itself would pass no matter
// what the constant became. 128/1024 is the size the gateway chose; 1000/5000
// is what bifrost substitutes for a zero, and is the defect being guarded.

// @scenario "A standard provider gets an explicit worker pool rather than the library default"
func TestGetConfigForProviderBoundsStandardProviderWorkerPool(t *testing.T) {
	cfg, err := (&account{}).GetConfigForProvider(bfschemas.OpenAI)
	require.NoError(t, err)

	assert.Equal(t, 128, cfg.ConcurrencyAndBufferSize.Concurrency,
		"a standard provider must get the gateway's bounded worker pool")
	assert.Equal(t, 1024, cfg.ConcurrencyAndBufferSize.BufferSize,
		"a standard provider must get the gateway's bounded queue")
}

// @scenario "Every advertised provider is bounded"
//
// The cost of this defect scales with the length of the advertised list, and
// the list grows on a bifrost upgrade without anyone here touching a file, so
// the guard walks every entry rather than sampling one.
func TestGetConfigForProviderBoundsEveryAdvertisedProvider(t *testing.T) {
	advertised, err := (&account{}).GetConfiguredProviders()
	require.NoError(t, err)
	require.NotEmpty(t, advertised, "the gateway advertises no providers at all")

	for _, provider := range advertised {
		cfg, err := (&account{}).GetConfigForProvider(provider)
		require.NoErrorf(t, err, "GetConfigForProvider(%q)", provider)

		assert.NotEqualf(t, 1000, cfg.ConcurrencyAndBufferSize.Concurrency,
			"provider %q fell back to bifrost's default worker pool; every advertised provider "+
				"is created eagerly, so one unbounded entry costs a thousand idle goroutines", provider)
		assert.NotEqualf(t, 5000, cfg.ConcurrencyAndBufferSize.BufferSize,
			"provider %q fell back to bifrost's default queue size", provider)
	}
}

// @scenario "A URL-derived compat endpoint keeps its own bound"
//
// Compat endpoints were bounded before the standard providers were, and are
// bounded by their registry cap as well. Sizing them stays a separate
// decision, so this pins that the standard-provider change did not reach in
// and alter it.
func TestGetConfigForProviderKeepsCompatEndpointBound(t *testing.T) {
	reg := newAnthropicCompatRegistry(anthropicCompatMaxEndpoints)
	provider := reg.register(domain.Credential{
		ProviderID: domain.ProviderAnthropic,
		APIKey:     "sk-ant",
		Extra:      map[string]string{"base_url": "http://vllm:8000/v1"},
	})

	cfg, err := (&account{anthropicCompat: reg}).GetConfigForProvider(provider)
	require.NoError(t, err)

	assert.Equal(t, 128, cfg.ConcurrencyAndBufferSize.Concurrency,
		"a compat endpoint keeps its own bounded pool")
	assert.Equal(t, 1024, cfg.ConcurrencyAndBufferSize.BufferSize,
		"a compat endpoint keeps its own bounded queue")
}
