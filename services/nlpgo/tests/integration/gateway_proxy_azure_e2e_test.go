package integration_test

// End-to-end guard for #5760 (P0): an Azure OpenAI chat completion driven
// through the real nlp-service /go/proxy HTTP surface — the exact surface the
// scenario User Simulator, playground, and prompt-testing use — must resolve
// the customer's endpoint AND the model's deployment and actually reach the
// provider, instead of failing 502 "endpoint not set" before any request
// leaves the box.
//
// Unlike workflow_llm_azure_e2e_test.go (build tag live_azure, real Azure),
// this test needs NO real Azure account: it points the Azure endpoint at a
// local stub and asserts Bifrost builds the Azure deployment URL and calls it.
// It spans the seam two package-local unit tests (gatewayproxy.headers_test +
// providers.bifrost_test) each cover in isolation — the exact cross-package
// "api_base" vs "endpoint" disagreement that caused #5760 — in one real run.
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
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
)

// azureShim adapts *dispatcher.Dispatcher to httpapi.DispatcherShim — the
// same mechanical field-copy cmd/root.go's playgroundDispatcherShim does,
// replicated here so the test wires the REAL dispatcher (Bifrost-backed)
// behind the real /go/proxy handler.
type azureShim struct{ disp *dispatcher.Dispatcher }

func (s azureShim) Dispatch(ctx context.Context, req httpapi.DispatchRequest) (*httpapi.DispatchResponse, error) {
	resp, err := s.disp.Dispatch(ctx, dispatcher.Request{Type: req.Type, Model: req.Model, Body: req.Body, Credential: req.Credential})
	if err != nil {
		return nil, err
	}
	return &httpapi.DispatchResponse{StatusCode: resp.StatusCode, Body: resp.Body, Headers: toHeader(resp.Headers)}, nil
}

func (s azureShim) DispatchStream(ctx context.Context, req httpapi.DispatchRequest) (httpapi.DispatchStream, error) {
	return s.disp.DispatchStream(ctx, dispatcher.Request{Type: req.Type, Model: req.Model, Body: req.Body, Credential: req.Credential})
}

func (s azureShim) Passthrough(ctx context.Context, req httpapi.PassthroughDispatchRequest) (*httpapi.DispatchResponse, error) {
	resp, err := s.disp.Passthrough(ctx, dispatcher.PassthroughRequest{
		Request: dispatcher.Request{Type: req.Type, Model: req.Model, Body: req.Body, Credential: req.Credential},
		HTTP:    domain.PassthroughRequest{Method: req.HTTPMethod, Path: req.HTTPPath, RawQuery: req.HTTPRawQuery, Headers: req.HTTPHeaders, Stream: req.Stream},
	})
	if err != nil {
		return nil, err
	}
	return &httpapi.DispatchResponse{StatusCode: resp.StatusCode, Body: resp.Body, Headers: toHeader(resp.Headers)}, nil
}

func (s azureShim) PassthroughStream(ctx context.Context, req httpapi.PassthroughDispatchRequest) (httpapi.DispatchStream, error) {
	return s.disp.PassthroughStream(ctx, dispatcher.PassthroughRequest{
		Request: dispatcher.Request{Type: req.Type, Model: req.Model, Body: req.Body, Credential: req.Credential},
		HTTP:    domain.PassthroughRequest{Method: req.HTTPMethod, Path: req.HTTPPath, RawQuery: req.HTTPRawQuery, Headers: req.HTTPHeaders, Stream: req.Stream},
	})
}

func toHeader(m map[string]string) http.Header {
	h := http.Header{}
	for k, v := range m {
		h.Set(k, v)
	}
	return h
}

func TestGatewayProxy_AzureChatCompletion_ResolvesEndpointAndDeployment(t *testing.T) {
	// Stub "Azure" endpoint: records the path Bifrost calls and returns a
	// minimal valid OpenAI chat-completion so the dispatch succeeds.
	var mu sync.Mutex
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotPath = r.URL.Path
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	t.Cleanup(upstream.Close)

	disp, err := dispatcher.New(context.Background(), dispatcher.Options{})
	require.NoError(t, err)
	t.Cleanup(disp.Close)

	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{
		Health:          probes,
		Version:         "test",
		PlaygroundProxy: httpapi.NewPlaygroundProxyFromShim(azureShim{disp: disp}),
	})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// A dotted Azure model id — the deployment key must survive intact.
	body := `{"model":"azure/gpt-4.1","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-litellm-model", "azure/gpt-4.1")
	req.Header.Set("x-litellm-api_key", "az-secret")
	req.Header.Set("x-litellm-api_base", upstream.URL) // the customer's Azure endpoint
	req.Header.Set("x-litellm-api_version", "2024-05-01-preview")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	// The gateway must NOT fail with the #5760 502 dispatcher_error / endpoint-not-set.
	require.Equalf(t, http.StatusOK, resp.StatusCode,
		"#5760: Azure /go/proxy must resolve the endpoint+deployment, got %d: %s", resp.StatusCode, respBody)

	// Bifrost's Azure provider builds <endpoint>/openai/deployments/<deployment>/chat/completions.
	// The stub receiving that exact path proves BOTH the endpoint (from api_base)
	// AND the deployment (self-mapped from the dotted model id) resolved.
	mu.Lock()
	path := gotPath
	mu.Unlock()
	assert.Equalf(t, "/openai/deployments/gpt-4.1/chat/completions", path,
		"upstream must be hit at the Azure deployment URL (endpoint + deployment resolved), got %q", path)
	assert.Contains(t, string(respBody), "ok", "the stub's completion must be forwarded back to the caller")
}
