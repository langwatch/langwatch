package httpapi

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// Scenarios: specs/security/org-private-model-endpoints.feature. The app
// sends the organization's bindings in a signed envelope (ADR-203); nlpgo
// accepts one only when its signature verifies under the configured public
// key, it has not expired, and it was signed for the request's project.
// Holding the internal secret authorizes nothing about bindings.

const testSecret = "s3cret"

const acmeBindingsJSON = `[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21","10.20.2.34"],"port":443}]`

var acmeBindings = []domain.PrivateEndpoint{{
	Hostname:  "llm.internal.acme.test",
	Addresses: []netip.Addr{netip.MustParseAddr("10.20.1.21"), netip.MustParseAddr("10.20.2.34")},
	Port:      443,
}}

func newTestKey() (ed25519.PublicKey, ed25519.PrivateKey) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		panic(err)
	}
	return pub, priv
}

var verifyKey, signingKey = newTestKey()

// signed is the header value the app sends for project, valid for ttl.
func signed(project string, ttl time.Duration, key ed25519.PrivateKey) string {
	return domain.SignPrivateEndpointsHeader(domain.PrivateEndpointsEnvelope{
		OrganizationID: "org_acme",
		ProjectID:      project,
		Bindings:       acmeBindings,
		ExpiresAt:      time.Now().Add(ttl),
	}, key)
}

// acmeHeaders are the two headers the app sets for a call in acme-prod.
func acmeHeaders() map[string]string {
	return map[string]string{
		domain.PrivateEndpointsHeader:        signed("acme-prod", 15*time.Minute, signingKey),
		domain.PrivateEndpointsProjectHeader: "acme-prod",
	}
}

func with(base map[string]string, extra map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func newGuardedProxyRouter(fake *fakeProxy, secret string, key ed25519.PublicKey) http.Handler {
	probes := health.New("test")
	probes.MarkStarted()
	return NewRouter(RouterDeps{
		Health:                    probes,
		Version:                   "test",
		PlaygroundProxy:           fake,
		InternalSecret:            secret,
		PrivateEndpointsVerifyKey: key,
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
	const path = "/go/proxy/v1/chat/completions"
	secret := map[string]string{InternalSecretHeader: testSecret}

	// @scenario "nlpgo accepts bindings only in an envelope signed for the request's project"
	t.Run("a valid envelope puts the bindings on the credential", func(t *testing.T) {
		fake := okBindingProxy()
		rec := httptest.NewRecorder()
		newGuardedProxyRouter(fake, testSecret, verifyKey).ServeHTTP(rec, proxyChatRequest(path, with(secret, acmeHeaders())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, acmeBindings, fake.gotRequest.Credential.PrivateEndpoints.List())
	})

	// @scenario "A project's studio Lambda accepts signed bindings without the internal secret"
	t.Run("an engine with no internal secret accepts a valid envelope", func(t *testing.T) {
		// A per-project NLP Lambda carries no internal secret: the signature
		// alone authorizes the bindings.
		fake := okBindingProxy()
		rec := httptest.NewRecorder()
		newGuardedProxyRouter(fake, "", verifyKey).ServeHTTP(rec, proxyChatRequest(path, acmeHeaders()))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, acmeBindings, fake.gotRequest.Credential.PrivateEndpoints.List())
	})

	t.Run("no header keeps today's rules", func(t *testing.T) {
		fake := okBindingProxy()
		rec := httptest.NewRecorder()
		newGuardedProxyRouter(fake, testSecret, verifyKey).ServeHTTP(rec, proxyChatRequest(path, secret))
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, fake.gotRequest.Credential.PrivateEndpoints.List())
	})

	// @scenario "Without a verify key nlpgo accepts no bindings"
	t.Run("no verify key configured ignores the header, even with the internal secret", func(t *testing.T) {
		fake := okBindingProxy()
		rec := httptest.NewRecorder()
		newGuardedProxyRouter(fake, testSecret, nil).ServeHTTP(rec, proxyChatRequest(path, with(secret, acmeHeaders())))
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, fake.gotRequest.Credential.PrivateEndpoints.List())
	})

	_, forger := newTestKey()
	refused := map[string]map[string]string{
		"a forged signature": {
			domain.PrivateEndpointsHeader:        signed("acme-prod", time.Minute, forger),
			domain.PrivateEndpointsProjectHeader: "acme-prod",
		},
		"an expired envelope": {
			domain.PrivateEndpointsHeader:        signed("acme-prod", -time.Second, signingKey),
			domain.PrivateEndpointsProjectHeader: "acme-prod",
		},
		"another project's envelope": {
			domain.PrivateEndpointsHeader:        signed("rival-prod", time.Minute, signingKey),
			domain.PrivateEndpointsProjectHeader: "acme-prod",
		},
		"an envelope with no project to check it against": {
			domain.PrivateEndpointsHeader: signed("acme-prod", time.Minute, signingKey),
		},
		"an unsigned binding list": {
			domain.PrivateEndpointsHeader:        base64.RawURLEncoding.EncodeToString([]byte(acmeBindingsJSON)),
			domain.PrivateEndpointsProjectHeader: "acme-prod",
		},
	}
	for name, headers := range refused {
		// @scenario "nlpgo refuses <envelope> with a 400 and never falls back to DNS"
		t.Run("refuses with a 400 and never dispatches: "+name, func(t *testing.T) {
			fake := okBindingProxy()
			rec := httptest.NewRecorder()
			newGuardedProxyRouter(fake, testSecret, verifyKey).ServeHTTP(rec, proxyChatRequest(path, with(secret, headers)))
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "invalid_private_endpoints")
			assert.NotContains(t, rec.Body.String(), "10.20.")
			assert.Zero(t, fake.called, "a refused binding set never reaches dispatch")
		})
	}
}

func TestFilterPassthroughHeaders_DropsPrivateEndpoints(t *testing.T) {
	in := http.Header{}
	for k, v := range acmeHeaders() {
		in.Set(k, v)
	}
	in.Set("X-Goog-Api-Client", "genai")
	out := filterPassthroughHeaders(in)
	assert.NotContains(t, out, domain.PrivateEndpointsHeader, "bindings name our addresses and never reach a provider")
	assert.NotContains(t, out, domain.PrivateEndpointsProjectHeader)
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

type workflowPost struct {
	secret  string
	key     ed25519.PublicKey
	body    string
	headers map[string]string
}

func postWorkflow(t *testing.T, path string, in workflowPost) (*httptest.ResponseRecorder, *capturingExecutor) {
	t.Helper()
	exec := &capturingExecutor{}
	router := NewRouter(RouterDeps{
		App:                       app.New(app.WithWorkflowExecutor(exec)),
		Health:                    health.New("test"),
		Version:                   "test",
		InternalSecret:            in.secret,
		PrivateEndpointsVerifyKey: in.key,
	})
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(in.body))
	req.Header.Set("Content-Type", "application/json")
	if in.secret != "" {
		req.Header.Set(InternalSecretHeader, in.secret)
	}
	for k, v := range in.headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec, exec
}

// The workflow routes take bindings from the signed header alone, never from
// the body: a workflow body can come from a caller the app relays unread.
func TestWorkflowRoutes_PrivateEndpoints(t *testing.T) {
	plain := `{"type":"execute_flow","payload":{"trace_id":"t","workflow":{"nodes":[],"edges":[]},"inputs":[{}]}}`
	inProject := func(project string) string {
		return `{"type":"execute_flow","payload":{"trace_id":"t","project_id":"` + project + `","workflow":{"nodes":[],"edges":[]},"inputs":[{}]}}`
	}
	bodyFields := map[string]string{
		"beside project_id in payload": `{"type":"execute_flow","payload":{"trace_id":"t","project_id":"acme-prod","workflow":{"nodes":[],"edges":[]},"inputs":[{}],"private_endpoints":` + acmeBindingsJSON + `}}`,
		"flat":                         `{"trace_id":"t","project_id":"acme-prod","workflow":{"nodes":[],"edges":[]},"private_endpoints":` + acmeBindingsJSON + `}`,
		"on the envelope":              `{"type":"execute_flow","private_endpoints":` + acmeBindingsJSON + `,"payload":{"trace_id":"t","project_id":"acme-prod","workflow":{"nodes":[],"edges":[]},"inputs":[{}]}}`,
	}

	for _, path := range []string{"/go/studio/execute_sync", "/go/studio/execute"} {
		t.Run(path+" accepts a valid envelope", func(t *testing.T) {
			rec, exec := postWorkflow(t, path, workflowPost{secret: testSecret, key: verifyKey, body: inProject("acme-prod"), headers: acmeHeaders()})
			require.Less(t, rec.Code, 400, rec.Body.String())
			require.Equal(t, 1, exec.calls)
			assert.Equal(t, acmeBindings, exec.seen)
		})

		t.Run(path+" accepts a valid envelope on an engine with no internal secret", func(t *testing.T) {
			rec, exec := postWorkflow(t, path, workflowPost{key: verifyKey, body: plain, headers: acmeHeaders()})
			require.Less(t, rec.Code, 400, rec.Body.String())
			assert.Equal(t, acmeBindings, exec.seen)
		})

		for name, body := range bodyFields {
			// @scenario "A private_endpoints field in a workflow body is ignored"
			t.Run(path+" ignores a body field even with the internal secret: "+name, func(t *testing.T) {
				rec, exec := postWorkflow(t, path, workflowPost{secret: testSecret, key: verifyKey, body: body})
				require.Less(t, rec.Code, 400, rec.Body.String())
				require.Equal(t, 1, exec.calls)
				assert.Empty(t, exec.seen, "a body field must never name addresses to dial")
			})
		}

		t.Run(path+" ignores the header when no verify key is configured", func(t *testing.T) {
			rec, exec := postWorkflow(t, path, workflowPost{secret: testSecret, body: plain, headers: acmeHeaders()})
			require.Less(t, rec.Code, 400, rec.Body.String())
			require.Equal(t, 1, exec.calls)
			assert.Empty(t, exec.seen)
		})

		t.Run(path+" refuses an envelope signed for another project than the body names", func(t *testing.T) {
			rec, exec := postWorkflow(t, path, workflowPost{secret: testSecret, key: verifyKey, body: inProject("rival-prod"), headers: acmeHeaders()})
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "invalid_private_endpoints")
			assert.Zero(t, exec.calls)
		})

		t.Run(path+" refuses an expired envelope", func(t *testing.T) {
			headers := with(acmeHeaders(), map[string]string{domain.PrivateEndpointsHeader: signed("acme-prod", -time.Second, signingKey)})
			rec, exec := postWorkflow(t, path, workflowPost{secret: testSecret, key: verifyKey, body: plain, headers: headers})
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Zero(t, exec.calls)
		})
	}
}
