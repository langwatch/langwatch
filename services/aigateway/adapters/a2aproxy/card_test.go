package a2aproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
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
