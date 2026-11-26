package a2aproxy

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/langwatch/services/aigateway/adapters/egress"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func (f *fixture) doWith(cfg Config, method, path, body string) *httptest.ResponseRecorder {
	cfg.Registry = f.registry
	cfg.Scanner = f.scanner
	cfg.Bundle = func(context.Context) *domain.Bundle { return f.bundle }
	if cfg.Client == nil {
		cfg.Client = f.upstream.Client()
	}
	if cfg.PublicBaseURL == "" {
		cfg.PublicBaseURL = testPublicBaseURL
	}
	cfg.Tracer = sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(f.spans)).Tracer("test")
	req := httptest.NewRequest(method, "http://gw.acme.test"+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk_support_secret")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	New(cfg).ServeHTTP(rec, req)
	return rec
}

// @scenario "a virtual key over its rate limit is refused"
func TestKeyOverRateLimitIsRefused(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.RateLimits.RPM = 1
	var gotKey string
	limit := func(_ context.Context, vk string, l domain.RateLimits) error {
		gotKey = vk
		if l.RPM == 1 {
			return errors.New("over")
		}
		return nil
	}
	rec := f.doWith(Config{RateLimit: limit}, http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hi"))

	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32021, code)
	assert.Equal(t, "a2a_rate_limited", reason)
	assert.Equal(t, "vk_support", gotKey)
	assert.Empty(t, f.upstreamCalls())
}

// @scenario "a virtual key with a used up budget is refused"
func TestKeyOverBudgetIsRefused(t *testing.T) {
	f := newFixture(t)
	block := func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
		return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
	}
	rec := f.doWith(Config{BudgetPrecheck: block}, http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hi"))

	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32022, code)
	assert.Equal(t, "a2a_budget_exceeded", reason)
	assert.Empty(t, f.upstreamCalls())

	failing := func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
		return domain.BudgetDecision{}, errors.New("ledger down")
	}
	rec = f.doWith(Config{BudgetPrecheck: failing}, http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hi"))
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

// @scenario "a plain http target is refused where https is required"
func TestPlainHTTPTargetIsRefusedWhenHTTPSIsRequired(t *testing.T) {
	f := newFixture(t)
	rec := f.doWith(Config{RequireHTTPS: true}, http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hi"))

	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32023, code)
	assert.Equal(t, "a2a_target_not_https", reason)
	assert.Empty(t, f.upstreamCalls())
}

// @scenario "Agent Card URLs use the configured public base URL"
func TestCardURLsUseConfiguredBaseURL(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"Billing","url":"` + f.upstream.URL + `/a2a"}`))
	}
	cfg := Config{PublicBaseURL: "https://gateway.acme.test/"}
	req := httptest.NewRequest(http.MethodGet, "http://evil.example/a2a/billing/.well-known/agent-card.json", nil)
	req.Header.Set("X-Forwarded-Proto", "http")
	cfg.Registry, cfg.Scanner, cfg.Client = f.registry, f.scanner, f.upstream.Client()
	cfg.Bundle = func(context.Context) *domain.Bundle { return f.bundle }
	rec := httptest.NewRecorder()
	New(cfg).ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"url":"https://gateway.acme.test/a2a/billing"`)
	assert.NotContains(t, rec.Body.String(), "evil.example")
}

// @scenario "a phrase split across streamed events is scanned whole"
func TestPhraseSplitAcrossStreamEventsIsBlocked(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "card number"}}
	first := `{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","append":true,"artifact":{"parts":[{"text":"your card num"}]}}}}`
	f.reply = sseReply(first,
		`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","append":true,"artifact":{"parts":[{"text":"ber 4111"}]}}}}`)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 2, rec.Body.String())
	assert.Equal(t, "data: "+first, chunks[0])
	assert.Contains(t, chunks[1], `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

// @scenario "an allowed host may resolve to a local address and no environment proxy is used"
func TestAllowedHostReachesLocalAddressWithoutEnvProxy(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	t.Cleanup(up.Close)

	blocked := NewUpstreamClient(UpstreamPolicy{BlockLocal: true})
	_, err := blocked.Get(up.URL)
	require.ErrorIs(t, err, egress.ErrBlocked)

	allowed := NewUpstreamClient(UpstreamPolicy{BlockLocal: true, AllowedHosts: []string{" 127.0.0.1. "}})
	resp, err := allowed.Get(up.URL)
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	assert.Nil(t, allowed.Transport.(*http.Transport).Proxy)

	byName := strings.Replace(up.URL, "127.0.0.1", "localhost", 1)
	_, err = allowed.Get(byName)
	require.ErrorIs(t, err, egress.ErrBlocked, "an allowed IP admits only a URL naming that IP, not a name resolving to it")
}
