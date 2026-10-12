package app

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Spec: specs/self-hosting/connected-services/managed-models-provider.feature
//
// The LangWatch-managed models slot is the last credential the install appends
// to every key, declaring no catalog. Prompts reach it only when the caller
// wrote the "langwatch/" prefix: a bare model name, or a call for another
// provider that fails over, never lands there.

func managedSlot() domain.Credential {
	return domain.Credential{ID: "langwatch_managed", ProviderID: domain.ProviderLangWatch, Models: []string{}}
}

// TestBareModelIsRefusedWhenLangWatchIsTheOnlyProvider checks that a key whose only provider is the LangWatch slot refuses a bare model.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestBareModelIsRefusedWhenLangWatchIsTheOnlyProvider(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{managedSlot()}}

	_, err := pick(t, cfg, bare("gpt-5-mini"))
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrModelNotRecognized), "got %v", err)
	assert.Contains(t, errMessage(err), `"langwatch"`, "the refusal names the prefix the key accepts")
}

// TestBareModelNoCatalogListsSkipsLangWatch checks that the no-catalog step for a bare model never picks the LangWatch slot.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestBareModelNoCatalogListsSkipsLangWatch(t *testing.T) {
	t.Parallel()

	// No provider declares gpt-5-mini and the guess table points at OpenAI,
	// which this key does not hold. The no-catalog step used to pick the
	// managed slot here. Now the key routes as if the slot were absent: its
	// lone provider gets the call and answers with its own error.
	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic, Models: []string{"claude-sonnet-5"}},
		managedSlot(),
	}}

	mustPick(t, cfg, bare("gpt-5-mini"), "anthropic_1")
}

// TestBareUnknownModelStaysOnTheNoCatalogProvider checks that a bare model no catalog lists goes to the org's own no-catalog provider.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestBareUnknownModelStaysOnTheNoCatalogProvider(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		managedSlot(),
	}}

	mustPick(t, cfg, bare("my-model"), "openai_1")
}

// TestBareUnknownModelWithCatalogProviderSkipsLangWatch checks that a bare model no catalog lists is never sent to the LangWatch slot.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestBareUnknownModelWithCatalogProviderSkipsLangWatch(t *testing.T) {
	t.Parallel()

	// A sole OpenAI credential with a catalog and the managed slot: two
	// credentials, so the old lone-credential step did not apply, and the
	// no-catalog step chose the managed slot alone.
	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
		managedSlot(),
	}}

	mustPick(t, cfg, bare("my-model"), "openai_1")
}

// TestBareModelFallbackChainLeavesOutLangWatch checks that the fallback chain for a bare model does not include the LangWatch slot.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestBareModelFallbackChainLeavesOutLangWatch(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "custom_1", ProviderID: domain.ProviderCustom},
		{ID: "bedrock_1", ProviderID: domain.ProviderBedrock},
		managedSlot(),
	}}

	mustPick(t, cfg, bare("my-model"), "custom_1", "bedrock_1")
}

// TestLangWatchIsNotTheSoleProviderForListedBareModels checks that the lone-credential step skips the LangWatch slot.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestLangWatchIsNotTheSoleProviderForListedBareModels(t *testing.T) {
	t.Parallel()

	assert.Equal(t, domain.ProviderOpenAI, soleCredentialProviderID([]domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		managedSlot(),
	}))
	assert.Equal(t, domain.ProviderID(""), soleCredentialProviderID([]domain.Credential{managedSlot()}))
}

// TestLangWatchPrefixedModelPicksTheManagedSlot checks that a langwatch/ model resolves to the LangWatch slot.
// @scenario "A langwatch-prefixed model routes to the langwatch provider"
func TestLangWatchPrefixedModelPicksTheManagedSlot(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		managedSlot(),
	}}

	resolved := cfg.ReadSpelling("langwatch/gpt-5-mini")
	mustPick(t, cfg, &resolved, "langwatch_managed")
}

// spellingModels resolves the request's model the way the real resolver reads
// a spelling: a known provider prefix is explicit, anything else is bare.
func spellingModels() *mockModels {
	return &mockModels{
		resolveFn: func(_ context.Context, req *domain.Request, cfg domain.BundleConfig) (*domain.ResolvedModel, error) {
			resolved := cfg.ReadSpelling(req.Model)
			return &resolved, nil
		},
	}
}

// TestHandleChat_LangWatchPrefixDispatchesToTheManagedSlot checks that a chat call for a langwatch/ model is dispatched to the LangWatch slot.
// @scenario "A langwatch-prefixed model routes to the langwatch provider"
func TestHandleChat_LangWatchPrefixDispatchesToTheManagedSlot(t *testing.T) {
	var attempted []string
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			attempted = append(attempted, cred.ID)
			return successResponse(), nil
		},
	}
	bundle := testBundle(
		domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		managedSlot(),
	)
	application := New(WithProviders(provider), WithModels(spellingModels()), WithLogger(zap.NewNop()))

	_, err := application.HandleChat(context.Background(), bundle,
		bytes.NewReader([]byte(`{"model":"langwatch/gpt-5-mini","messages":[]}`)), "langwatch/gpt-5-mini")
	require.NoError(t, err)
	assert.Equal(t, []string{"langwatch_managed"}, attempted)
}

// TestHandleChat_RetryableFailureNeverFallsBackToLangWatch checks that a retryable failure on another provider never retries on the LangWatch slot.
// @scenario "A call for another provider never falls back to LangWatch"
func TestHandleChat_RetryableFailureNeverFallsBackToLangWatch(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{name: "when the provider answers 429", err: &domain.UpstreamError{StatusCode: 429, Message: "rate limited"}},
		{name: "when the provider answers 503", err: &domain.UpstreamError{StatusCode: 503, Message: "unavailable"}},
		{name: "when the provider answers 404", err: &domain.UpstreamError{StatusCode: 404, Message: "model not found"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var attempted []string
			provider := &mockProvider{
				dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
					attempted = append(attempted, cred.ID)
					if cred.ProviderID == domain.ProviderLangWatch {
						return successResponse(), nil
					}
					return nil, tc.err
				},
			}
			bundle := testBundle(
				domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
				domain.Credential{ID: "openai_2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
				managedSlot(),
			)
			application := New(WithProviders(provider), WithModels(spellingModels()), WithLogger(zap.NewNop()))

			_, err := application.HandleChat(context.Background(), bundle,
				bytes.NewReader([]byte(`{"model":"openai/gpt-5-mini","messages":[]}`)), "openai/gpt-5-mini")
			require.Error(t, err)
			assert.Equal(t, []string{"openai_1", "openai_2"}, attempted)
		})
	}
}

// TestHandleChat_BareModelRetryableFailureNeverFallsBackToLangWatch checks that a retryable failure on a bare model never retries on the LangWatch slot.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestHandleChat_BareModelRetryableFailureNeverFallsBackToLangWatch(t *testing.T) {
	var attempted []string
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			attempted = append(attempted, cred.ID)
			if cred.ProviderID == domain.ProviderLangWatch {
				return successResponse(), nil
			}
			return nil, &domain.UpstreamError{StatusCode: 503, Message: "unavailable"}
		},
	}
	bundle := testBundle(
		domain.Credential{ID: "custom_1", ProviderID: domain.ProviderCustom, APIKey: "sk-1"},
		managedSlot(),
	)
	application := New(WithProviders(provider), WithModels(spellingModels()), WithLogger(zap.NewNop()))

	_, err := application.HandleChat(context.Background(), bundle,
		bytes.NewReader([]byte(`{"model":"my-model","messages":[]}`)), "my-model")
	require.Error(t, err)
	assert.Equal(t, []string{"custom_1"}, attempted)
}

// TestHandleChat_BareModelOnALangWatchOnlyKeyIsRefused checks that a chat call with a bare model on a LangWatch-only key is refused.
// @scenario "A model name without the langwatch prefix never reaches LangWatch"
func TestHandleChat_BareModelOnALangWatchOnlyKeyIsRefused(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("no provider may be dialed for a bare model on a langwatch-only key")
			return nil, nil
		},
	}
	bundle := testBundle(managedSlot())
	application := New(WithProviders(provider), WithModels(spellingModels()), WithLogger(zap.NewNop()))

	_, err := application.HandleChat(context.Background(), bundle,
		bytes.NewReader([]byte(`{"model":"gpt-5-mini","messages":[]}`)), "gpt-5-mini")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrModelNotRecognized), "got %v", err)
}
