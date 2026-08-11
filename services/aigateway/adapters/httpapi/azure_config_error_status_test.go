package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Defect B, end to end: a provider configuration error carries no HTTP status
// because no HTTP call was made, and classifyBifrostError treats status 0 as a
// gateway timeout. The client therefore sees 504 for a permanent, operator-
// fixable misconfiguration, and the retry engine — which treats a timeout as
// retryable — burns the whole credential fallback chain on every request.
//
// These tests run the real dispatch stack (real BifrostRouter, real model
// resolver, real error-status registry) so the assertions are on the wire, not
// on an internal.
//
// The instrument is a missing Azure endpoint rather than a missing deployment
// map: both are the same status-less bfschemas.BifrostError from the same
// vendor constructor, but once Defect A is fixed a missing deployment map no
// longer produces an error at all, so it cannot isolate the classification
// half. "deployments not set" is pinned at the unit level in
// adapters/providers/bifrost_config_error_classification_test.go.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// countingUpstream records how many requests reached it and answers each with a
// valid chat completion.
type countingUpstream struct {
	*httptest.Server
	hits atomic.Int32
}

func newCountingUpstream(t *testing.T, respondModel string) *countingUpstream {
	t.Helper()
	up := &countingUpstream{}
	up.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		up.hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"id":"chatcmpl-test","object":"chat.completion","created":1,"model":%q,`+
			`"choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],`+
			`"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`, respondModel)
	}))
	t.Cleanup(up.Close)
	return up
}

func azureLaneRouter(t *testing.T, creds ...domain.Credential) http.Handler {
	t.Helper()
	registerErrorStatuses()

	bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	t.Cleanup(bf.Close)

	bundle := &domain.Bundle{
		VirtualKeyID: "vk-test",
		ProjectID:    "proj-test",
		TeamID:       "team-test",
		Credentials:  creds,
		Config: domain.BundleConfig{
			Fallback: domain.FallbackConfig{MaxAttempts: len(creds)},
		},
	}
	auth := &mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
		return bundle, nil
	}}
	return buildRouter(
		app.WithAuth(auth),
		app.WithProviders(bf),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)
}

func azureChatRequest(model string) *http.Request {
	body := fmt.Sprintf(`{"model":%q,"messages":[{"role":"user","content":"hi"}]}`, model)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(body)))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	return req
}

// AC16 + AC20: the client-visible answer to a provider misconfiguration is a
// bad-gateway, not a gateway timeout, and it still names the cause.
//
// 502 is asserted concretely: if the fix registers its chosen code at a
// different status, this test is where that decision has to be made explicit.
//
// @scenario "A status-less configuration error is not reported as a timeout"
func TestAzureLane_ConfigurationErrorIsNotSurfacedAsATimeout(t *testing.T) {
	router := azureLaneRouter(t, domain.Credential{
		ID:         "cred-azure",
		ProviderID: domain.ProviderAzure,
		APIKey:     "az-key",
		// No endpoint: the provider row was never finished. Bifrost rejects
		// this before dialing, with no HTTP status to report.
		Extra: map[string]string{"api_version": "2024-10-21"},
	})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, azureChatRequest("azure/gpt-5.3-mini"))

	assert.Equal(t, http.StatusBadGateway, rec.Code,
		"a permanent provider misconfiguration must not be reported as an upstream timeout; body: %s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), "endpoint not set",
		"the operator's only clue to the misconfiguration must survive to the client")
}

// AC17, the operational half: a permanent configuration failure must not walk
// the credential fallback chain. Pre-fix it classifies as a timeout, which the
// retry engine treats as retryable, so every request pays for every credential
// in the chain before failing (the production trace showed eight identical
// attempt pairs).
//
// The second credential is fully working, so "it was never dialed" can only be
// explained by the chain not being walked.
//
// @scenario "A configuration failure does not walk the credential fallback chain"
func TestAzureLane_ConfigurationErrorDoesNotWalkTheFallbackChain(t *testing.T) {
	healthy := newCountingUpstream(t, "gpt-5.3-mini")

	router := azureLaneRouter(t,
		domain.Credential{
			ID:         "cred-azure-misconfigured",
			ProviderID: domain.ProviderAzure,
			APIKey:     "az-key",
			Extra:      map[string]string{"api_version": "2024-10-21"},
		},
		domain.Credential{
			ID:            "cred-azure-healthy",
			ProviderID:    domain.ProviderAzure,
			APIKey:        "az-key-2",
			Extra:         map[string]string{"endpoint": healthy.URL, "api_version": "2024-10-21"},
			DeploymentMap: map[string]string{"gpt-5.3-mini": "gpt-5.3-mini"},
		},
	)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, azureChatRequest("azure/gpt-5.3-mini"))

	assert.Zero(t, healthy.hits.Load(),
		"a permanent configuration failure is not retryable; the fallback chain must not be walked")
	assert.Equal(t, http.StatusBadGateway, rec.Code,
		"the misconfiguration must be reported, not masked by a fallback; body: %s", rec.Body.String())
}

// AC19, the status half: the code→status contract the router installs. Composes
// with the code half in adapters/providers/bifrost_config_error_classification_test.go
// (which package boundaries keep separate — providers cannot import httpapi,
// and the registry is only populated here).
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature
func TestRegisterErrorStatuses_ProviderCodeBaseline(t *testing.T) {
	registerErrorStatuses()

	cases := []struct {
		code herr.Code
		want int
	}{
		{code: domain.ErrProviderTimeout, want: http.StatusGatewayTimeout},
		{code: domain.ErrProviderError, want: http.StatusBadGateway},
		{code: domain.ErrRateLimited, want: http.StatusTooManyRequests},
	}

	for _, tc := range cases {
		t.Run(string(tc.code), func(t *testing.T) {
			assert.Equal(t, tc.want, herr.HTTPStatus(herr.New(context.Background(), tc.code, nil)))
		})
	}
}
