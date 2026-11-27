package a2aproxy

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const cardPathOnTheGateway = "/a2a/billing/.well-known/agent-card.json"

// cardHost serves an Agent Card and records the upstream token each fetch carried.
type cardHost struct {
	mu     sync.Mutex
	tokens []string
	calls  int
}

func (h *cardHost) handler(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	h.calls++
	h.tokens = append(h.tokens, r.Header.Get("X-Billing-Token"))
	h.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"name":"Billing","url":"https://billing.acme.test/a2a"}`)
}

func (h *cardHost) seen() (int, []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.calls, append([]string(nil), h.tokens...)
}

// @scenario "an Agent Card URL on plain http is refused where https is required"
func TestPlainHTTPCardURLIsRefusedWhenHTTPSIsRequired(t *testing.T) {
	f := newFixture(t)
	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(secure.Close)
	var card cardHost
	plain := httptest.NewServer(http.HandlerFunc(card.handler))
	t.Cleanup(plain.Close)
	f.setTarget(func(tg *domain.A2ATarget) {
		tg.UpstreamURL = secure.URL + "/a2a"
		tg.CardURL = plain.URL + "/card.json"
	})

	rec := f.doWith(Config{RequireHTTPS: true, Client: secure.Client()}, http.MethodGet, cardPathOnTheGateway, "")

	assert.Equal(t, http.StatusBadGateway, rec.Code, rec.Body.String())
	assert.Equal(t, "a2a_target_not_https", httpError(t, rec))
	calls, _ := card.seen()
	assert.Zero(t, calls, "the plain http card URL must not be fetched")
}

// @scenario "the target's upstream headers go only to an Agent Card on the upstream's own origin"
func TestUpstreamHeadersGoOnlyToACardOnTheUpstreamOrigin(t *testing.T) {
	f := newFixture(t)
	var other cardHost
	elsewhere := httptest.NewServer(http.HandlerFunc(other.handler))
	t.Cleanup(elsewhere.Close)
	f.setTarget(func(tg *domain.A2ATarget) { tg.CardURL = elsewhere.URL + "/card.json" })

	rec := f.do(http.MethodGet, cardPathOnTheGateway, "")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	calls, tokens := other.seen()
	require.Equal(t, 1, calls)
	assert.Equal(t, []string{""}, tokens, "a card on another origin must not receive the upstream token")
}

// @scenario "the target's upstream headers go only to an Agent Card on the upstream's own origin"
func TestUpstreamHeadersGoToACardOnTheUpstreamOrigin(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"name":"Billing"}`)
	}
	f.setTarget(func(tg *domain.A2ATarget) { tg.CardURL = f.upstream.URL + "/cards/billing.json" })

	rec := f.do(http.MethodGet, cardPathOnTheGateway, "")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	calls := f.upstreamCalls()
	require.Len(t, calls, 1)
	assert.Equal(t, "/cards/billing.json", calls[0].path)
	assert.Equal(t, "upstream-secret", calls[0].token)
}

func TestSameOrigin(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want bool
	}{
		{"https://billing.acme.test/a2a", "https://billing.acme.test/.well-known/agent-card.json", true},
		{"https://billing.acme.test/a2a", "https://BILLING.acme.test:443/card", true},
		{"http://billing.acme.test/a2a", "http://billing.acme.test:80/card", true},
		{"https://billing.acme.test/a2a", "http://billing.acme.test/card", false},
		{"https://billing.acme.test/a2a", "https://billing.acme.test:8443/card", false},
		{"https://billing.acme.test/a2a", "https://cards.acme.test/card", false},
		{"https://billing.acme.test/a2a", "https://billing.acme.test.evil.test/card", false},
		{"https://billing.acme.test/a2a", "https://user@evil.test/card", false},
		{"https://billing.acme.test/a2a", "not a url", false},
	} {
		assert.Equal(t, tc.want, sameOrigin(tc.a, tc.b), "%s vs %s", tc.a, tc.b)
	}
}

// @scenario "the Agent Card lists only the endpoint the gateway serves"
func TestCardAdvertisesOnlyTheServedEndpointAndV02PathWorks(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		base := f.upstream.URL + "/a2a"
		_, _ = fmt.Fprintf(w, `{"url":%q,"supportedInterfaces":[{"url":%q},{"url":%q}]}`, base+"/v1", base, base+"/v1")
	}
	rec := f.do(http.MethodGet, "/a2a/billing/.well-known/agent.json", "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.JSONEq(t, `{"url":"http://gw.acme.test/a2a/billing","supportedInterfaces":[{"url":"http://gw.acme.test/a2a/billing"}]}`, rec.Body.String())
}

// @scenario "an extended Agent Card error reply is relayed without a gateway card URL"
func TestRewriteReplyCardLeavesErrorRepliesAlone(t *testing.T) {
	const upstream, proxy = "https://agent.test", "https://gw.test/a2a/agent"
	for name, body := range map[string]string{
		"JSON-RPC error envelope": `{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"no card"}}`,
		"HTTP+JSON error body":    `{"error":{"code":404,"message":"no card"}}`,
		"JSON-RPC null result":    `{"jsonrpc":"2.0","id":1,"result":null}`,
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, body, string(rewriteReplyCard([]byte(body), upstream, proxy)))
		})
	}
	for name, body := range map[string]string{
		"JSON-RPC result card": `{"jsonrpc":"2.0","id":1,"result":{"name":"a","url":"https://agent.test"}}`,
		"bare card":            `{"name":"a","url":"https://agent.test"}`,
	} {
		t.Run(name, func(t *testing.T) {
			assert.Contains(t, string(rewriteReplyCard([]byte(body), upstream, proxy)), proxy)
		})
	}
}

// @scenario "an extended Agent Card error reply is relayed without a gateway card URL"
func TestExtendedCardHTTPErrorWithoutWrapperIsRelayedUnchanged(t *testing.T) {
	const unavailable = `{"message":"unavailable"}`
	for name, call := range map[string][3]string{
		"HTTP+JSON": {http.MethodGet, "/a2a/billing/extendedAgentCard", ""},
		"JSON-RPC":  {http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":7,"method":"GetExtendedAgentCard"}`},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			f.reply = func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = io.WriteString(w, unavailable)
			}
			rec := f.do(call[0], call[1], call[2])
			assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
			assert.JSONEq(t, unavailable, rec.Body.String(), "relayed without a gateway card URL")

			f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
			f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "unavailable"}}
			scanned := f.do(call[0], call[1], call[2])
			assert.Contains(t, scanned.Body.String(), "a2a_content_blocked", "the error reply is still scanned")
		})
	}
}

// @scenario "an A2A v0.2 card request reads the agent's v0.2 card path"
func TestLegacyCardRequestFetchesTheLegacyPath(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/a2a"+legacyCardPath {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"name":"Billing","url":"`+f.upstream.URL+`/a2a"}`)
	}
	rec := f.do(http.MethodGet, "/a2a/billing/.well-known/agent.json", "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"url":"http://gw.acme.test/a2a/billing"`)

	modern := f.do(http.MethodGet, cardPathOnTheGateway, "")
	assert.Equal(t, http.StatusBadGateway, modern.Code, "the v1.0 request keeps the v1.0 path")

	f.setTarget(func(tg *domain.A2ATarget) { tg.CardURL = f.upstream.URL + "/a2a" + legacyCardPath })
	modern = f.do(http.MethodGet, cardPathOnTheGateway, "")
	assert.Equal(t, http.StatusOK, modern.Code, "a configured Agent Card URL wins")
}

// @scenario "an Agent Card is refused when the gateway has no public base URL"
func TestCardIsRefusedWithoutAPublicBaseURL(t *testing.T) {
	f := newFixture(t)
	h := New(Config{
		Registry: f.registry,
		Bundle:   func(context.Context) *domain.Bundle { return f.bundle },
		Client:   f.upstream.Client(),
	})
	serve := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://evil.example"+path, strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	rec := serve(http.MethodGet, cardPathOnTheGateway, "")
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Equal(t, "a2a_public_url_unset", httpError(t, rec))
	assert.NotContains(t, rec.Body.String(), "evil.example")

	rec = serve(http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":7,"method":"GetExtendedAgentCard"}`)
	code, reason, id := rpcError(t, rec)
	assert.Equal(t, -32024, code)
	assert.Equal(t, "a2a_public_url_unset", reason)
	assert.Equal(t, "7", id)
	assert.Empty(t, f.upstreamCalls(), "no card is fetched that the gateway cannot point at itself")

	rec = serve(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hi"))
	assert.Contains(t, rec.Body.String(), "TASK_STATE_COMPLETED", "other calls need no public base URL")
}
