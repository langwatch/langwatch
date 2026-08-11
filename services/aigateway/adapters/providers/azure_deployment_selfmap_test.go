package providers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Azure routes on deployment, not on model id. Bifrost reads the deployment
// out of AzureKeyConfig.Deployments keyed by the request's Model, and rejects
// the dispatch outright when the map is nil ("deployments not set") or lacks
// the key ("deployment not found for model X") — before any network call.
//
// The control-plane/VK path builds its credential at
// adapters/controlplane/config_wire.go:385, which never calls
// domain.WithDeploymentSelfMap, so every Azure request on that path arrives
// with a nil map. These tests drive the real BifrostRouter against a local
// stand-in for a customer's Azure resource and assert on the deployment
// segment of the URL Bifrost builds, which IS Deployments[bfReq.Model] by
// vendor construction (core@v1.4.22 providers/azure/azure.go getModelDeployment).
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// azureResourceStub stands in for a customer's Azure OpenAI resource. It
// records the deployment segment of every request path it is asked to serve,
// so a test can read back the value Bifrost resolved without reaching into
// unexported dispatch internals.
type azureResourceStub struct {
	*httptest.Server

	mu    sync.Mutex
	paths []string
}

func newAzureResourceStub(t *testing.T, respondModel string) *azureResourceStub {
	t.Helper()
	stub := &azureResourceStub{}
	stub.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stub.mu.Lock()
		stub.paths = append(stub.paths, r.URL.Path)
		stub.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"id":"chatcmpl-test","object":"chat.completion","created":1,"model":%q,`+
			`"choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],`+
			`"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`, respondModel)
	}))
	t.Cleanup(stub.Close)
	return stub
}

// deployment returns the single deployment Bifrost resolved for the dispatch.
// Azure's URL is /openai/deployments/{deployment}/chat/completions and the
// deployment may itself contain slashes (an unresolved request model keeps its
// "azure/" prefix), so the segment is taken by trimming both ends.
func (s *azureResourceStub) deployment(t *testing.T) string {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()

	require.Len(t, s.paths, 1, "expected exactly one upstream request, got paths %q", s.paths)
	const prefix = "/openai/deployments/"
	const suffix = "/chat/completions"
	path := s.paths[0]
	require.True(t, strings.HasPrefix(path, prefix) && strings.HasSuffix(path, suffix),
		"unexpected Azure request path %q", path)
	return strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
}

func newTestBifrostRouter(t *testing.T) *BifrostRouter {
	t.Helper()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	t.Cleanup(router.Close)
	return router
}

// TestAzureDispatch_ResolvesDeploymentForControlPlaneCredential is the
// regression for Defect A. Every row is a credential the control plane can
// actually produce; each must reach the upstream with a resolved deployment.
//
// The rows are one table because they assert one property of one call — the
// deployment the upstream was actually asked for — over the inputs that reach
// it. Splitting them into a test per scenario would duplicate the fixture five
// times to vary a struct field, so the scenarios are declared together here.
//
// @scenario "A slot with no deployment_map on the wire still resolves a deployment"
// @scenario "The deployment-map key equals the model string placed on the provider request"
// @scenario "A resolved model dispatches on its bare model id"
// @scenario "An unresolved model keeps request model and map key identical"
// @scenario "Deployment precedence is wire mapping, then explicit deployment, then the model id"
func TestAzureDispatch_ResolvesDeploymentForControlPlaneCredential(t *testing.T) {
	cases := []struct {
		name string
		// request as the gateway builds it
		reqModel string
		resolved *domain.ResolvedModel
		// credential as the control plane materializes it
		wireDeploymentMap  map[string]string
		explicitDeployment string // Extra["deployment"], set by the provider row
		// wantDeployment empty means "the model Bifrost was handed" — the
		// self-map default. Stated as a rule rather than a literal so the
		// expectation cannot drift away from the request (AC4).
		wantDeployment string
	}{
		{
			// AC1 / AC3 / AC5: the exact shape production VK traffic takes.
			name:     "no wired deployment map, explicitly prefixed model",
			reqModel: "azure/gpt-5.3-mini",
			resolved: &domain.ResolvedModel{ModelID: "gpt-5.3-mini", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
		},
		{
			// AC2: the empty-map slot must behave identically to the absent one.
			name:              "empty wired deployment map, explicitly prefixed model",
			reqModel:          "azure/gpt-5.3-mini",
			resolved:          &domain.ResolvedModel{ModelID: "gpt-5.3-mini", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
			wireDeploymentMap: map[string]string{},
		},
		{
			// AC5: alias-resolved model, same requirement.
			name:     "no wired deployment map, alias-resolved model",
			reqModel: "fast-mini",
			resolved: &domain.ResolvedModel{ModelID: "gpt-5.3-mini", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceAlias},
		},
		{
			// AC5: implicitly resolved model, same requirement.
			name:     "no wired deployment map, implicitly resolved model",
			reqModel: "gpt-5.3-mini",
			resolved: &domain.ResolvedModel{ModelID: "gpt-5.3-mini", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceImplicit},
		},
		{
			// AC6: the unresolved fallback path. The model Bifrost is handed
			// still carries the "azure/" prefix, and the map key must match it
			// byte for byte — a "bare model" self-map would miss here.
			name:     "no wired deployment map, model never resolved",
			reqModel: "azure/gpt-5.3-mini",
			resolved: nil,
		},
		{
			// AC7 / AC8 row 1: a wired entry outranks Extra["deployment"].
			name:               "wired entry wins over an explicit deployment",
			reqModel:           "azure/gpt-4.1",
			resolved:           &domain.ResolvedModel{ModelID: "gpt-4.1", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
			wireDeploymentMap:  map[string]string{"gpt-4.1": "wire-dep"},
			explicitDeployment: "extra-dep",
			wantDeployment:     "wire-dep",
		},
		{
			// AC8 row 2: with no wired entry, Extra["deployment"] outranks the
			// bare model.
			name:               "explicit deployment wins over the bare model",
			reqModel:           "azure/gpt-4.1",
			resolved:           &domain.ResolvedModel{ModelID: "gpt-4.1", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
			explicitDeployment: "extra-dep",
			wantDeployment:     "extra-dep",
		},
		{
			// AC8 row 3: with neither, the model id is the deployment name.
			name:     "bare model is the default deployment",
			reqModel: "azure/gpt-4.1",
			resolved: &domain.ResolvedModel{ModelID: "gpt-4.1", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
		},
		{
			// AC7: unrelated wired entries neither serve nor block this model,
			// and must survive the dispatch untouched.
			name:              "unrelated wired entries do not block the requested model",
			reqModel:          "azure/gpt-4.1",
			resolved:          &domain.ResolvedModel{ModelID: "gpt-4.1", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
			wireDeploymentMap: map[string]string{"gpt-5.3-mini": "prod-mini"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// The string Bifrost's request carries in Model, derived from this
			// row's own inputs by the rule Dispatch applies (bifrost.go:192-199).
			// AC4 requires the map key to equal that string, so the expectation
			// is a function of the request and not a hardcoded key.
			bfModel := tc.reqModel
			if tc.resolved != nil {
				bfModel = tc.resolved.ModelID
			}
			want := tc.wantDeployment
			if want == "" {
				want = bfModel
			}

			stub := newAzureResourceStub(t, bfModel)
			router := newTestBifrostRouter(t)

			extra := map[string]string{"endpoint": stub.URL, "api_version": "2024-10-21"}
			if tc.explicitDeployment != "" {
				extra["deployment"] = tc.explicitDeployment
			}
			cred := domain.Credential{
				ID:            "cred-azure",
				ProviderID:    domain.ProviderAzure,
				APIKey:        "az-key",
				Extra:         extra,
				DeploymentMap: tc.wireDeploymentMap,
			}
			req := &domain.Request{
				Type:     domain.RequestTypeChat,
				Model:    tc.reqModel,
				Resolved: tc.resolved,
				Body:     []byte(fmt.Sprintf(`{"model":%q,"messages":[{"role":"user","content":"hi"}]}`, tc.reqModel)),
			}

			resp, err := router.Dispatch(context.Background(), req, cred)
			require.NoError(t, err,
				"Azure dispatch must resolve a deployment for model %q; the control-plane credential carries deployment_map %#v",
				bfModel, tc.wireDeploymentMap)
			require.NotNil(t, resp)

			assert.Equal(t, want, stub.deployment(t),
				"the deployment Bifrost looked up is Deployments[%q]", bfModel)
		})
	}
}

// AC23, and the second half of AC7: dispatch must not mutate the credential's
// wired map. The chokepoint copies on write (domain.WithDeploymentSelfMap), and
// a fix that writes through the reference would corrupt the bundle cache shared
// by every request on that virtual key.
//
// @scenario "The self-map never mutates the caller's map"
func TestAzureDispatch_DoesNotMutateTheBundlesDeploymentMap(t *testing.T) {
	stub := newAzureResourceStub(t, "gpt-4.1")
	router := newTestBifrostRouter(t)

	wired := map[string]string{"gpt-5.3-mini": "prod-mini"}
	cred := domain.Credential{
		ID:            "cred-azure",
		ProviderID:    domain.ProviderAzure,
		APIKey:        "az-key",
		Extra:         map[string]string{"endpoint": stub.URL, "api_version": "2024-10-21"},
		DeploymentMap: wired,
	}
	req := &domain.Request{
		Type:     domain.RequestTypeChat,
		Model:    "azure/gpt-4.1",
		Resolved: &domain.ResolvedModel{ModelID: "gpt-4.1", ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
		Body:     []byte(`{"model":"azure/gpt-4.1","messages":[{"role":"user","content":"hi"}]}`),
	}

	_, err := router.Dispatch(context.Background(), req, cred)
	require.NoError(t, err)

	assert.Equal(t, map[string]string{"gpt-5.3-mini": "prod-mini"}, wired,
		"the bundle's deployment map is shared across requests and must not be written through")
}

// AC10, the "no Azure key configuration is fabricated" half. The other half,
// that the credential's own map stays nil, is held at the chokepoint itself in
// domain/deployment_self_map_chokepoint_test.go.
//
// @scenario "Providers without deployments are left untouched"
func TestCredentialToBifrostKey_NonMappedProvidersGetNoDeploymentConfig(t *testing.T) {
	cases := []struct {
		name     string
		cred     domain.Credential
		provider bfschemas.ModelProvider
	}{
		{
			name:     "openai",
			cred:     domain.Credential{ID: "cred-openai", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"},
			provider: bfschemas.OpenAI,
		},
		{
			name:     "anthropic",
			cred:     domain.Credential{ID: "cred-anthropic", ProviderID: domain.ProviderAnthropic, APIKey: "sk-ant-test"},
			provider: bfschemas.Anthropic,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Nil(t, tc.cred.DeploymentMap, "fixture precondition")

			key := credentialToBifrostKey(tc.cred, tc.provider)

			assert.Nil(t, key.AzureKeyConfig, "no AzureKeyConfig may be fabricated for %s", tc.name)
			assert.Nil(t, key.BedrockKeyConfig, "no BedrockKeyConfig may be fabricated for %s", tc.name)
			assert.Nil(t, key.VertexKeyConfig, "no VertexKeyConfig may be fabricated for %s", tc.name)
			assert.Nil(t, tc.cred.DeploymentMap, "the credential's nil deployment map must stay nil")
		})
	}
}
