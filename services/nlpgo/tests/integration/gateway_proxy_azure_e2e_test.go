package integration_test

// HTTP-boundary guard for #5760 (P0): an Azure OpenAI chat completion driven
// through the real nlp-service /go/proxy HTTP surface — the exact surface the
// scenario User Simulator, playground, and prompt-testing use — must resolve
// customer's endpoint AND the model's deployment into the dispatcher request.
//
// Unlike workflow_llm_azure_e2e_test.go (build tag live_azure, real Azure),
// this test needs NO real Azure account. The provider adapter's package test
// separately pins api_base -> Bifrost AzureKeyConfig.Endpoint. Keeping the
// boundary test on a capture shim is intentional: customer endpoint SSRF
// protection must reject the loopback HTTP server this test used previously.
//
// It uses a DOTTED Azure model id ("azure/gpt-4.1") on purpose: it pins that
// the model→deployment key survives the TS→Go boundary intact, so a future
// model-id translation change turns this RED instead of silently re-breaking
// Azure.

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
)

type azureCaptureShim struct {
	request httpapi.DispatchRequest
}

func (s *azureCaptureShim) Dispatch(_ context.Context, req httpapi.DispatchRequest) (*httpapi.DispatchResponse, error) {
	s.request = req
	return &httpapi.DispatchResponse{
		StatusCode: http.StatusOK,
		Body:       []byte(`{"id":"chatcmpl-x","choices":[{"message":{"content":"ok"}}]}`),
		Headers:    http.Header{"Content-Type": []string{"application/json"}},
	}, nil
}

func (s *azureCaptureShim) DispatchStream(context.Context, httpapi.DispatchRequest) (httpapi.DispatchStream, error) {
	panic("unexpected streaming dispatch")
}

func (s *azureCaptureShim) Passthrough(context.Context, httpapi.PassthroughDispatchRequest) (*httpapi.DispatchResponse, error) {
	panic("unexpected passthrough dispatch")
}

func (s *azureCaptureShim) PassthroughStream(context.Context, httpapi.PassthroughDispatchRequest) (httpapi.DispatchStream, error) {
	panic("unexpected streaming passthrough dispatch")
}

func TestGatewayProxy_AzureChatCompletion_ResolvesEndpointAndDeployment(t *testing.T) {
	shim := &azureCaptureShim{}

	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{
		Health:          probes,
		Version:         "test",
		PlaygroundProxy: httpapi.NewPlaygroundProxyFromShim(shim),
	})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// A dotted Azure model id — the deployment key must survive intact.
	body := `{"model":"azure/gpt-4.1","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-litellm-model", "azure/gpt-4.1")
	req.Header.Set("x-litellm-api_key", "az-secret")
	req.Header.Set("x-litellm-api_base", "https://acme.openai.azure.com")
	req.Header.Set("x-litellm-api_version", "2024-05-01-preview")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	require.Equalf(t, http.StatusOK, resp.StatusCode,
		"#5760: Azure /go/proxy must resolve the endpoint+deployment, got %d: %s", resp.StatusCode, respBody)

	assert.Equal(t, domain.ProviderAzure, shim.request.Credential.ProviderID)
	assert.Equal(t, "https://acme.openai.azure.com", shim.request.Credential.Extra["api_base"])
	assert.Equal(t, "gpt-4.1", shim.request.Model)
	assert.Equal(t, "gpt-4.1", shim.request.Credential.DeploymentMap["gpt-4.1"])
	assert.Contains(t, string(respBody), "ok", "the stub's completion must be forwarded back to the caller")
}
