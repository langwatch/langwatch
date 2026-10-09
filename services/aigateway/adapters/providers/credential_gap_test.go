package providers

import (
	"context"
	"net/http"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// A provider row saved enabled with no credentials reaches the gateway as a
// slot whose API key is empty. Bifrost's key selection drops a key with no
// value and answers "no keys found that support model", the sentence it also
// uses for a key that lists other models, so the customer was told to check
// their models and deployments when the provider had no key at all.
//
// Spec: specs/ai-gateway/error-transparency.feature

func requireConfigProblem(t *testing.T, err error, want domain.ConfigProblem) herr.E {
	t.Helper()
	require.Error(t, err)
	var e herr.E
	require.ErrorAs(t, err, &e)
	assert.Equal(t, domain.ErrProviderConfigInvalid, e.Code)
	assert.Equal(t, string(want), e.Meta["problem"])
	return e
}

// @scenario "A provider saved without its API key is refused before dispatch and says so"
func TestDispatch_ProviderWithNoAPIKeyNamesTheMissingKey(t *testing.T) {
	// Any request reaching this server is the failure: nothing may be sent
	// for a provider that holds no key.
	upstream := newRecordedUpstream(t, http.StatusOK, responsesAnswer)
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: upstream.server.URL,
	})
	require.NoError(t, err)
	t.Cleanup(router.Close)

	keyless := domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI}

	lanes := map[string]*domain.Request{
		"responses": openAIResponsesRequest(`{"model":"gpt-5.6-terra","input":"hi"}`),
		"chat": {
			Type:     domain.RequestTypeChat,
			Model:    "openai/gpt-5.6-terra",
			Body:     []byte(`{"model":"gpt-5.6-terra","messages":[{"role":"user","content":"hi"}]}`),
			Resolved: &domain.ResolvedModel{ProviderID: domain.ProviderOpenAI, ModelID: "gpt-5.6-terra"},
		},
	}
	for name, req := range lanes {
		t.Run(name, func(t *testing.T) {
			_, syncErr := router.Dispatch(context.Background(), req, keyless)
			e := requireConfigProblem(t, syncErr, domain.ConfigProblemAPIKeyMissing)
			assert.Equal(t, "openai", e.Meta["provider"])
			assert.Equal(t, "gpt-5.6-terra", e.Meta["model"])
			message, _ := e.Meta["message"].(string)
			assert.Contains(t, message, "no API key saved")
			assert.NotContains(t, message, "deployments",
				"a provider with no key must not be told to check its deployments")

			_, streamErr := router.DispatchStream(context.Background(), req, keyless)
			requireConfigProblem(t, streamErr, domain.ConfigProblemAPIKeyMissing)
		})
	}

	_, _, _, hits := upstream.snapshot()
	assert.Zero(t, hits, "no request leaves the gateway for a provider with no key")
}

// @scenario "Each provider setup gap gets its own instruction"
func TestCredentialProblem_NamesWhatTheSlotIsMissing(t *testing.T) {
	cases := []struct {
		name string
		cred domain.Credential
		want domain.ConfigProblem
	}{
		{
			name: "an anthropic provider with no key",
			cred: domain.Credential{ID: "c", ProviderID: domain.ProviderAnthropic},
			want: domain.ConfigProblemAPIKeyMissing,
		},
		{
			name: "a key that is only whitespace",
			cred: domain.Credential{ID: "c", ProviderID: domain.ProviderOpenAI, APIKey: "  "},
			want: domain.ConfigProblemAPIKeyMissing,
		},
		{
			name: "an azure provider with no endpoint",
			cred: domain.Credential{ID: "c", ProviderID: domain.ProviderAzure, APIKey: "k"},
			want: domain.ConfigProblemEndpointMissing,
		},
		{
			name: "a custom provider with no base URL",
			cred: domain.Credential{ID: "c", ProviderID: domain.ProviderCustom, APIKey: "k"},
			want: domain.ConfigProblemEndpointMissing,
		},
		{
			name: "an openai provider with a key",
			cred: domain.Credential{ID: "c", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"},
			want: "",
		},
		{
			name: "an unauthenticated self-hosted endpoint",
			cred: domain.Credential{
				ID: "c", ProviderID: domain.ProviderCustom,
				Extra: map[string]string{"base_url": "http://llm.internal:8000/v1"},
			},
			want: "",
		},
		{
			name: "an openai provider with a base URL and no key",
			cred: domain.Credential{
				ID: "c", ProviderID: domain.ProviderOpenAI,
				Extra: map[string]string{"base_url": "http://llm.internal:8000/v1"},
			},
			want: "",
		},
		{
			name: "an unauthenticated anthropic-compatible endpoint",
			cred: domain.Credential{
				ID: "c", ProviderID: domain.ProviderAnthropic,
				Extra: map[string]string{"base_url": "http://llm.internal:8000"},
			},
			want: "",
		},
		{
			name: "bedrock, which signs with its own key pair",
			cred: domain.Credential{ID: "c", ProviderID: domain.ProviderBedrock},
			want: "",
		},
		{
			name: "vertex, which authenticates with a service account",
			cred: domain.Credential{ID: "c", ProviderID: domain.ProviderVertex},
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, credentialProblem(tc.cred, mapProvider(tc.cred)))
		})
	}
}

// What bifrost reports on its own keeps a problem too, so the three messages
// that share provider_config_invalid stop sharing one sentence.
// @scenario "Each provider setup gap gets its own instruction"
func TestClassifyBifrostError_ConfigProblemsAreToldApart(t *testing.T) {
	cases := []struct {
		name        string
		berr        *bfschemas.BifrostError
		want        domain.ConfigProblem
		wantMessage string
	}{
		{
			name: "no deployment map",
			berr: &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{Message: "deployments not set"},
				ExtraFields: bfschemas.BifrostErrorExtraFields{
					Provider: bfschemas.Azure, OriginalModelRequested: "gpt-5.6-terra",
				},
			},
			want:        domain.ConfigProblemDeploymentMissing,
			wantMessage: `no deployment mapped for "gpt-5.6-terra"`,
		},
		{
			name: "no endpoint",
			berr: &bfschemas.BifrostError{
				Error:       &bfschemas.ErrorField{Message: "endpoint not set"},
				ExtraFields: bfschemas.BifrostErrorExtraFields{Provider: bfschemas.Azure},
			},
			want:        domain.ConfigProblemEndpointMissing,
			wantMessage: "no endpoint URL saved",
		},
		{
			name: "an operation the provider does not implement",
			berr: &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{
					Message: "chat_completion is not supported by elevenlabs provider",
					Code:    bfPtr("unsupported_operation"),
				},
			},
			want:        domain.ConfigProblemOperationUnsupported,
			wantMessage: "does not support this kind of request",
		},
		{
			name: "a key that serves other models",
			berr: &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{Message: "no keys found that support model: gpt-5.6-terra"},
				ExtraFields: bfschemas.BifrostErrorExtraFields{
					Provider: bfschemas.OpenAI, OriginalModelRequested: "gpt-5.6-terra",
				},
			},
			want:        domain.ConfigProblemModelNotServed,
			wantMessage: `not configured to serve "gpt-5.6-terra"`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := requireConfigProblem(t, classifyBifrostError(context.Background(), tc.berr), tc.want)
			message, _ := e.Meta["message"].(string)
			assert.Contains(t, message, tc.wantMessage)
		})
	}
}

// Every other code answers without a problem: the field means something only
// beside provider_config_invalid.
func TestClassifyBifrostError_OtherCodesCarryNoProblem(t *testing.T) {
	err := classifyBifrostError(context.Background(), &bfschemas.BifrostError{
		Error: &bfschemas.ErrorField{Message: "failed to retrieve aws credentials"},
	})
	var e herr.E
	require.ErrorAs(t, err, &e)
	assert.Equal(t, domain.ErrProviderCredentialInvalid, e.Code)
	assert.NotContains(t, e.Meta, "problem")
}
