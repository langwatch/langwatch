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
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Azure addresses a model by deployment name, and its v1 API carries that name
// in the request body's `model` field. Azure is raw-forwarded
// (isOpenAICompatibleProvider), so the client's own bytes are what reach the
// wire: whatever the gateway resolves has to land in that field, or it never
// leaves the box.
//
// The control plane only emits `deployment_map` when the provider row carries
// an explicit deployment mapping (config.materialiser.ts), which most Azure
// rows do not: by default the model id IS the deployment name. Every other
// dispatch path already closes that gap with domain.WithDeploymentSelfMap
// (nlpgo's dispatcheradapter and gatewayproxy, #5760); the gateway did not, so
// the same Azure provider that worked in the playground missed its deployment
// through the gateway.
//
// These tests drive the real dispatch path against a local upstream standing
// in for the customer's Azure resource, so what they observe is the request
// Bifrost actually sends, not a restatement of the mapping helper.

// azureUpstream answers with an OpenAI-shaped chat completion (Azure's wire
// format) and keeps every request it received, in arrival order.
type azureUpstream struct {
	srv    *httptest.Server
	mu     sync.Mutex
	bodies [][]byte
}

func (u *azureUpstream) received() [][]byte {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([][]byte(nil), u.bodies...)
}

func (u *azureUpstream) deploymentAddressed(t *testing.T, n int) string {
	t.Helper()
	bodies := u.received()
	require.Greater(t, len(bodies), n,
		"the request must actually reach the customer's Azure resource")
	return gjson.GetBytes(bodies[n], "model").String()
}

func newAzureUpstream(t *testing.T) *azureUpstream {
	t.Helper()
	u := &azureUpstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.bodies = append(u.bodies, body)
		u.mu.Unlock()
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

func azureChatRequest(isStream bool) *domain.Request {
	body := `{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`
	if isStream {
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

	req := azureChatRequest(false)
	sent := append([]byte(nil), req.Body...)

	resp, err := router.Dispatch(context.Background(), req,
		azureCredNoDeploymentMap(upstream.srv.URL))
	require.NoError(t, err,
		"an Azure credential without an explicit deployment mapping must still dispatch")
	require.NotNil(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	assert.Equal(t, "gpt-5-mini", upstream.deploymentAddressed(t, 0),
		"the deployment defaults to the model id, so the request must address deployment gpt-5-mini")
	// Azure is raw-forwarded to keep OpenAI's prompt-prefix auto-cache hitting.
	// With nothing to remap, the customer's bytes must go out untouched.
	assert.Equal(t, string(sent), string(upstream.received()[0]),
		"with no deployment to remap the body must be forwarded byte-for-byte")
}

// The streaming lane resolves its credential separately from Dispatch, so it
// needs its own resolution or stream:true keeps missing the deployment on
// Azure while the non-streaming call gets it right.
//
// @scenario "Gateway streaming chat completion for an Azure model reaches the deployment named by the model id"
func TestDispatchStream_Azure_NoDeploymentMap_SelfMapsToModelID(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	iter, err := router.DispatchStream(context.Background(), azureChatRequest(true),
		azureCredNoDeploymentMap(upstream.srv.URL))
	require.NoError(t, err,
		"the streaming lane must resolve the deployment too, or stream:true fails "+
			"on Azure providers the non-streaming lane serves fine")
	for iter.Next(context.Background()) {
	}
	require.NoError(t, iter.Err(),
		"the stream must drain cleanly; a mid-stream failure would leave the assertion "+
			"below passing on a request that never produced a usable answer")

	assert.Equal(t, "gpt-5-mini", upstream.deploymentAddressed(t, 0),
		"the deployment defaults to the model id, so the request must address deployment gpt-5-mini")
}

// An explicit mapping is the provider saying the model id is NOT the
// deployment name. Dropping it sends Azure a deployment it does not have.
//
// @scenario "An explicit deployment mapping still decides the deployment on the gateway lane"
func TestDispatch_Azure_ExplicitDeploymentMap_Wins(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	cred := azureCredNoDeploymentMap(upstream.srv.URL)
	cred.DeploymentMap = map[string]string{"gpt-5-mini": "prod-mini-eastus"}

	_, err := router.Dispatch(context.Background(), azureChatRequest(false), cred)
	require.NoError(t, err)

	assert.Equal(t, "prod-mini-eastus", upstream.deploymentAddressed(t, 0),
		"the provider's own mapping decides the deployment; the default only fills a gap")
}

// app.dispatch walks the credential chain with retry.Walk and hands the SAME
// *domain.Request to Dispatch on every attempt, so resolving the deployment
// must not write back into it. If it did, the first credential's deployment
// would still be in the body on the second attempt: the guard early-returns
// when deployment == model, so nothing rewrites it back, and the next Azure
// resource is asked for a deployment it does not have.
//
// @scenario "A deployment resolved for one credential does not leak into the next attempt"
func TestDispatch_Azure_DeploymentDoesNotLeakAcrossCredentials(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	req := azureChatRequest(false)
	sent := append([]byte(nil), req.Body...)

	mapped := azureCredNoDeploymentMap(upstream.srv.URL)
	mapped.DeploymentMap = map[string]string{"gpt-5-mini": "prod-mini-eastus"}
	_, err := router.Dispatch(context.Background(), req, mapped)
	require.NoError(t, err)

	// Second attempt, as a failover would run it: same request pointer, a
	// credential whose resource serves the model under its own name.
	_, err = router.Dispatch(context.Background(), req, azureCredNoDeploymentMap(upstream.srv.URL))
	require.NoError(t, err)

	assert.Equal(t, "prod-mini-eastus", upstream.deploymentAddressed(t, 0))
	assert.Equal(t, "gpt-5-mini", upstream.deploymentAddressed(t, 1),
		"the second credential names no deployment, so its resource must be asked "+
			"for gpt-5-mini and not the first credential's prod-mini-eastus")
	assert.Equal(t, string(sent), string(req.Body),
		"the caller's request is shared across retry attempts, so resolving the "+
			"deployment must leave it untouched")
}

// The other side of the same leak, and the worse one: the non-Azure guard
// returns before the deployment comparison, so an in-place rewrite would hand
// a plain OpenAI provider an Azure deployment name as its model.
func TestDispatch_Azure_DeploymentDoesNotLeakIntoANonAzureFallback(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	req := azureChatRequest(false)

	mapped := azureCredNoDeploymentMap(upstream.srv.URL)
	mapped.DeploymentMap = map[string]string{"gpt-5-mini": "prod-mini-eastus"}
	_, err := router.Dispatch(context.Background(), req, mapped)
	require.NoError(t, err)

	// Failover off Azure entirely, onto a provider that has never heard of
	// deployments and serves the model under its own name.
	fallback := domain.Credential{
		ID:         "mp-openai",
		ProviderID: domain.ProviderOpenAI,
		APIKey:     "sk-test",
		Extra:      map[string]string{"base_url": upstream.srv.URL},
	}
	_, err = router.Dispatch(context.Background(), req, fallback)
	require.NoError(t, err)

	assert.Equal(t, "prod-mini-eastus", upstream.deploymentAddressed(t, 0))
	assert.Equal(t, "gpt-5-mini", upstream.deploymentAddressed(t, 1),
		"a non-Azure credential must be sent the model id, never the Azure "+
			"deployment name left over from the previous attempt")
}

// The two lanes read the deployment from the same place, so this covers the
// streaming seam and the other credential shape at once: a deployment named
// alongside the credential rather than in a mapping, which is what
// WithDeploymentSelfMap folds into DeploymentMap for both lanes to read.
//
// @scenario "The streaming lane honors an explicit deployment name too"
func TestDispatchStream_Azure_ExplicitDeployment_Wins(t *testing.T) {
	upstream := newAzureUpstream(t)
	router := azureRouter(t)

	cred := azureCredNoDeploymentMap(upstream.srv.URL)
	cred.Extra["deployment"] = "prod-mini-eastus"

	iter, err := router.DispatchStream(context.Background(), azureChatRequest(true), cred)
	require.NoError(t, err)
	for iter.Next(context.Background()) {
	}
	require.NoError(t, iter.Err(), "the stream must drain cleanly")

	assert.Equal(t, "prod-mini-eastus", upstream.deploymentAddressed(t, 0),
		"the provider's own deployment name decides the deployment on the streaming lane too")
}
