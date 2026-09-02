package providers

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Azure addresses a model by deployment name, so Bifrost's Azure provider
// refuses to build a URL for a key whose AzureKeyConfig.Deployments is empty
// ("deployments not set") — the request never leaves the gateway, and the
// caller sees an opaque provider error instead of a completion.
//
// The control plane only emits `deployment_map` when the provider row carries
// an explicit deployment mapping (config.materialiser.ts), which most Azure
// rows do not: by default the model id IS the deployment name. Every other
// dispatch path already closes that gap with domain.WithDeploymentSelfMap
// (nlpgo's dispatcheradapter and gatewayproxy, #5760); the gateway did not,
// so the same Azure provider that worked in the playground failed through the
// gateway.
//
// These tests drive the real dispatch path against a local upstream standing
// in for the customer's Azure resource, so what they observe is the URL
// Bifrost actually builds, not a restatement of the mapping helper.

// azureUpstream records the path of every request it receives and answers
// with an OpenAI-shaped chat completion (Azure's wire format).
type azureUpstream struct {
	srv *httptest.Server
	mu  sync.Mutex
	// paths holds each received request path, in arrival order.
	paths []string
}

func (u *azureUpstream) received() []string {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]string(nil), u.paths...)
}

func newAzureUpstream(t *testing.T) *azureUpstream {
	t.Helper()
	u := &azureUpstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.mu.Lock()
		u.paths = append(u.paths, r.URL.Path)
		u.mu.Unlock()
		body, _ := io.ReadAll(r.Body)
		if bytes.Contains(body, []byte(`"stream":true`)) {
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`data: {"id":"chatcmpl-azure1","object":"chat.completion.chunk",` +
				`"created":1730000000,"model":"gpt-5-mini","choices":[{"index":0,` +
				`"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}` + "\n\n" +
				"data: [DONE]\n\n"))
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"chatcmpl-azure1","object":"chat.completion",` +
			`"created":1730000000,"model":"gpt-5-mini","choices":[{"index":0,` +
			`"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],` +
			`"usage":{"prompt_tokens":9,"completion_tokens":1,"total_tokens":10}}`))
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func azureRouter(t *testing.T) *BifrostRouter {
	t.Helper()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	t.Cleanup(router.Close)
	return router
}

// azureCredNoDeploymentMap is the shape the control plane sends for an Azure
// provider row with no explicit deployment mapping: api key, endpoint, api
// version, and nothing that says which deployment serves the model.
func azureCredNoDeploymentMap(endpoint string) domain.Credential {
	return domain.Credential{
		ID:         "mp-azure",
		ProviderID: domain.ProviderAzure,
		APIKey:     "az-test",
		Extra: map[string]string{
			"endpoint":    endpoint,
			"api_version": "2025-04-01-preview",
		},
	}
}

func azureChatRequest(stream bool) *domain.Request {
	body := `{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`
	if stream {
		body = `{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}],"stream":true}`
	}
	return &domain.Request{
		Type:     domain.RequestTypeChat,
		Model:    "azure/gpt-5-mini",
		Resolved: &domain.ResolvedModel{ModelID: "gpt-5-mini", ProviderID: domain.ProviderAzure},
		Body:     []byte(body),
	}
}

// Spec: specs/ai-gateway/azure-endpoint-from-api-base.feature
//
// @scenario "Gateway chat completion for an Azure model reaches the deployment named by the model id"
func TestDispatch_Azure_NoDeploymentMap_SelfMapsToModelID(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	resp, err := router.Dispatch(context.Background(), azureChatRequest(false),
		azureCredNoDeploymentMap(upstream.srv.URL))
	require.NoError(t, err,
		"an Azure credential without an explicit deployment mapping must still dispatch; "+
			"without the self-map Bifrost refuses with \"deployments not set\" and nothing leaves the gateway")
	require.NotNil(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	paths := upstream.received()
	require.Len(t, paths, 1, "the request must actually reach the customer's Azure resource")
	assert.Contains(t, paths[0], "/openai/deployments/gpt-5-mini/",
		"the deployment defaults to the model id, so the URL must address deployment gpt-5-mini")
}

// The streaming lane resolves its credential separately from Dispatch, so it
// needs its own self-map or /v1/chat/completions with stream:true keeps
// failing on Azure while the non-streaming call succeeds.
//
// @scenario "Gateway streaming chat completion for an Azure model reaches the deployment named by the model id"
func TestDispatchStream_Azure_NoDeploymentMap_SelfMapsToModelID(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	iter, err := router.DispatchStream(context.Background(), azureChatRequest(true),
		azureCredNoDeploymentMap(upstream.srv.URL))
	require.NoError(t, err,
		"the streaming lane must self-map the deployment too, or stream:true fails "+
			"on Azure providers the non-streaming lane serves fine")
	for iter.Next(context.Background()) {
	}

	paths := upstream.received()
	require.NotEmpty(t, paths, "the stream must actually reach the customer's Azure resource")
	assert.Contains(t, paths[0], "/openai/deployments/gpt-5-mini/",
		"the deployment defaults to the model id, so the URL must address deployment gpt-5-mini")
}

// An explicit mapping is the provider saying the model id is NOT the
// deployment name. The self-map must never overwrite it.
//
// @scenario "An explicit deployment mapping still decides the deployment on the gateway lane"
func TestDispatch_Azure_ExplicitDeploymentMap_Wins(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	cred := azureCredNoDeploymentMap(upstream.srv.URL)
	cred.DeploymentMap = map[string]string{"gpt-5-mini": "prod-mini-eastus"}

	_, err := router.Dispatch(context.Background(), azureChatRequest(false), cred)
	require.NoError(t, err)

	paths := upstream.received()
	require.Len(t, paths, 1)
	assert.Contains(t, paths[0], "/openai/deployments/prod-mini-eastus/",
		"the provider's own mapping decides the deployment; the self-map only fills a gap")
}
