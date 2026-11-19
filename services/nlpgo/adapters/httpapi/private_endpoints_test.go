package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// Scenarios: specs/security/org-private-model-endpoints.feature. The app
// sends the organization's bindings on its internal calls (ADR-203); nlpgo
// honours them only on requests that presented the internal secret.

const testSecret = "s3cret"

const acmeBindingsJSON = `[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21","10.20.2.34"],"port":443}]`

var acmeBindings = []domain.PrivateEndpoint{{
	Hostname:  "llm.internal.acme.test",
	Addresses: []netip.Addr{netip.MustParseAddr("10.20.1.21"), netip.MustParseAddr("10.20.2.34")},
	Port:      443,
}}

func acmeHeader() string {
	return base64.RawURLEncoding.EncodeToString([]byte(acmeBindingsJSON))
}

func newGuardedProxyRouter(fake *fakeProxy, secret string) http.Handler {
	probes := health.New("test")
	probes.MarkStarted()
	return NewRouter(RouterDeps{
		Health:          probes,
		Version:         "test",
		PlaygroundProxy: fake,
		InternalSecret:  secret,
	})
}

func proxyChatRequest(path string, headers map[string]string) *http.Request {
	body := `{"model":"openai/acme-model","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-litellm-model", "openai/acme-model")
	req.Header.Set("x-litellm-api_key", "sk-test")
	req.Header.Set("x-litellm-api_base", "https://llm.internal.acme.test/v1")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return req
}

func okBindingProxy() *fakeProxy {
	return &fakeProxy{syncResp: &playgroundProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    http.Header{"Content-Type": []string{"application/json"}},
		Body:       []byte(`{"choices":[]}`),
	}}
}

func TestPlaygroundProxy_PrivateEndpointsHeader(t *testing.T) {
	t.Run("an authenticated request carries the bindings on the credential", func(t *testing.T) {
		fake := okBindingProxy()
		rec := httptest.NewRecorder()
		newGuardedProxyRouter(fake, testSecret).ServeHTTP(rec, proxyChatRequest("/go/proxy/v1/chat/completions", map[string]string{
			InternalSecretHeader:          testSecret,
			domain.PrivateEndpointsHeader: acmeHeader(),
		}))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, acmeBindings, fake.gotRequest.Credential.PrivateEndpoints)
	})

	t.Run("no header keeps today's rules", func(t *testing.T) {
		fake := okBindingProxy()
		rec := httptest.NewRecorder()
		newGuardedProxyRouter(fake, testSecret).ServeHTTP(rec, proxyChatRequest("/go/proxy/v1/chat/completions", map[string]string{
			InternalSecretHeader: testSecret,
		}))
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, fake.gotRequest.Credential.PrivateEndpoints)
	})

	t.Run("an install with no internal secret ignores the header", func(t *testing.T) {
		fake := okBindingProxy()
		rec := httptest.NewRecorder()
		newGuardedProxyRouter(fake, "").ServeHTTP(rec, proxyChatRequest("/go/proxy/v1/chat/completions", map[string]string{
			domain.PrivateEndpointsHeader: acmeHeader(),
		}))
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, fake.gotRequest.Credential.PrivateEndpoints,
			"an open route must not let a caller name addresses to dial")
	})

	for name, value := range map[string]string{
		"not base64url":        "%%%",
		"padded":               acmeHeader() + "=",
		"not JSON":             base64.RawURLEncoding.EncodeToString([]byte("nope")),
		"an IP-literal name":   base64.RawURLEncoding.EncodeToString([]byte(`[{"hostname":"10.20.1.21","addresses":["10.20.1.21"],"port":443}]`)),
		"an out-of-range port": base64.RawURLEncoding.EncodeToString([]byte(`[{"hostname":"a.test","addresses":["10.20.1.21"],"port":0}]`)),
	} {
		t.Run("a malformed header is a 400: "+name, func(t *testing.T) {
			fake := okBindingProxy()
			rec := httptest.NewRecorder()
			newGuardedProxyRouter(fake, testSecret).ServeHTTP(rec, proxyChatRequest("/go/proxy/v1/chat/completions", map[string]string{
				InternalSecretHeader:          testSecret,
				domain.PrivateEndpointsHeader: value,
			}))
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "invalid_private_endpoints")
			assert.Zero(t, fake.called, "a malformed binding list never reaches dispatch")
		})
	}
}

func TestFilterPassthroughHeaders_DropsPrivateEndpoints(t *testing.T) {
	in := http.Header{}
	in.Set(domain.PrivateEndpointsHeader, acmeHeader())
	in.Set("X-Goog-Api-Client", "genai")
	out := filterPassthroughHeaders(in)
	assert.NotContains(t, out, domain.PrivateEndpointsHeader, "bindings name our addresses and never reach a provider")
	assert.Contains(t, out, "X-Goog-Api-Client")
}

// capturingExecutor records the bindings the workflow ran under.
type capturingExecutor struct {
	calls int
	seen  []domain.PrivateEndpoint
}

func (c *capturingExecutor) Execute(ctx context.Context, _ app.WorkflowRequest) (*app.WorkflowResult, error) {
	c.calls++
	c.seen = domain.PrivateEndpointsFromContext(ctx)
	return &app.WorkflowResult{}, nil
}

func (c *capturingExecutor) ExecuteStream(ctx context.Context, _ app.WorkflowRequest, _ app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	c.calls++
	c.seen = domain.PrivateEndpointsFromContext(ctx)
	events := make(chan app.WorkflowStreamEvent)
	close(events)
	return events, nil
}

func postWorkflow(t *testing.T, secret, path, body string) (*httptest.ResponseRecorder, *capturingExecutor) {
	t.Helper()
	exec := &capturingExecutor{}
	router := NewRouter(RouterDeps{
		App:            app.New(app.WithWorkflowExecutor(exec)),
		Health:         health.New("test"),
		Version:        "test",
		InternalSecret: secret,
	})
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		req.Header.Set(InternalSecretHeader, secret)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec, exec
}

func TestWorkflowPayload_PrivateEndpoints(t *testing.T) {
	discriminated := `{"type":"execute_flow","payload":{"trace_id":"t","project_id":"acme-prod","workflow":{"nodes":[],"edges":[]},"inputs":[{}],"private_endpoints":` + acmeBindingsJSON + `}}`
	flat := `{"trace_id":"t","project_id":"acme-prod","workflow":{"nodes":[],"edges":[]},"private_endpoints":` + acmeBindingsJSON + `}`
	envelope := `{"type":"execute_flow","private_endpoints":` + acmeBindingsJSON + `,"payload":{"trace_id":"t","project_id":"acme-prod","workflow":{"nodes":[],"edges":[]},"inputs":[{}]}}`

	for _, path := range []string{"/go/studio/execute_sync", "/go/studio/execute"} {
		for name, body := range map[string]string{"beside project_id in payload": discriminated, "flat": flat, "on the envelope": envelope} {
			t.Run(path+" reads the bindings "+name, func(t *testing.T) {
				rec, exec := postWorkflow(t, testSecret, path, body)
				require.Less(t, rec.Code, 400, rec.Body.String())
				require.Equal(t, 1, exec.calls)
				assert.Equal(t, acmeBindings, exec.seen)
			})
		}

		t.Run(path+" without bindings runs with none", func(t *testing.T) {
			rec, exec := postWorkflow(t, testSecret, path, executeSyncBody)
			require.Less(t, rec.Code, 400, rec.Body.String())
			assert.Empty(t, exec.seen)
		})

		t.Run(path+" ignores bindings on an install with no internal secret", func(t *testing.T) {
			rec, exec := postWorkflow(t, "", path, discriminated)
			require.Less(t, rec.Code, 400, rec.Body.String())
			assert.Empty(t, exec.seen)
		})

		t.Run(path+" refuses malformed bindings with a 400", func(t *testing.T) {
			body := strings.Replace(discriminated, acmeBindingsJSON, `[{"hostname":"*.acme.test","addresses":["10.20.1.21"],"port":443}]`, 1)
			rec, exec := postWorkflow(t, testSecret, path, body)
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "invalid_private_endpoints")
			assert.Zero(t, exec.calls)
		})
	}
}
