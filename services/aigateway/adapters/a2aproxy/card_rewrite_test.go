package a2aproxy

import (
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNullAgentCardIsRefused(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "null")
	}
	rec := f.do(http.MethodGet, cardPathOnTheGateway, "")

	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Equal(t, "a2a_upstream_unreachable", httpError(t, rec))
}

// @scenario "an extended Agent Card error reply is relayed without a gateway card URL"
func TestNullExtendedCardReplyIsRelayedUnchanged(t *testing.T) {
	const upstream, proxy = "https://agent.test", "https://gw.test/a2a/agent"
	for _, body := range []string{"null", " null\n"} {
		assert.Equal(t, body, string(rewriteReplyCard([]byte(body), upstream, proxy)))
	}
}

// @scenario "the Agent Card is served with the gateway URL in place of the upstream"
func TestCardRewriteKeepsNumbersAsWritten(t *testing.T) {
	const upstream, proxy = "https://agent.test", "https://gw.test/a2a/agent"
	body := `{"jsonrpc":"2.0","id":9007199254740993,"result":{"url":"https://agent.test","x-limit":1.10}}`
	out := string(rewriteReplyCard([]byte(body), upstream, proxy))
	assert.Contains(t, out, `"id":9007199254740993`)
	assert.Contains(t, out, `"x-limit":1.10`)
	assert.Equal(t, body+" {}", string(rewriteReplyCard([]byte(body+" {}"), upstream, proxy)), "trailing input is no card")

	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"name":"Billing","url":"`+f.upstream.URL+`/a2a","capabilities":{"x-quota":12345678901234567890}}`)
	}
	rec := f.do(http.MethodGet, cardPathOnTheGateway, "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"x-quota":12345678901234567890`)
}

// @scenario "the Agent Card is served with the gateway URL in place of the upstream"
func TestCardRewriteDropsTheUpstreamSignatures(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"name":"Billing","url":"`+f.upstream.URL+`/a2a","signatures":[{"protected":"eyJhbGciOiJFUzI1NiJ9","signature":"c2ln"}]}`)
	}
	rec := f.do(http.MethodGet, cardPathOnTheGateway, "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "signature")

	reply := `{"jsonrpc":"2.0","id":1,"result":{"url":"https://agent.test","signatures":[{"signature":"c2ln"}]}}`
	assert.NotContains(t, string(rewriteReplyCard([]byte(reply), "https://agent.test", "https://gw.test/a2a/agent")), "signature")
}

// @scenario "the Agent Card lists only the endpoint the gateway serves"
func TestSameEndpoint(t *testing.T) {
	const upstream = "https://agent.example/a2a?tenant=t1"
	for _, tc := range []struct {
		u    string
		want bool
	}{
		{"https://agent.example/a2a?tenant=t1", true},
		{"https://agent.example/a2a/?tenant=t1", true},
		{"https://AGENT.example:443/a2a?tenant=t1", true},
		{"HTTPS://agent.example/a2a?tenant=t1", true},
		{"https://agent.example/A2A?tenant=t1", false},
		{"https://agent.example/a2a/v1?tenant=t1", false},
		{"https://agent.example/a2a?tenant=t2", false},
		{"https://agent.example/a2a", false},
		{"https://agent.example:8443/a2a?tenant=t1", false},
		{"http://agent.example/a2a?tenant=t1", false},
		{"/a2a?tenant=t1", false},
	} {
		assert.Equal(t, tc.want, sameEndpoint(tc.u, upstream), tc.u)
	}

	card := map[string]any{"supportedInterfaces": []any{map[string]any{"url": "https://AGENT.example:443/a2a?tenant=t1"}}}
	rewriteCard(card, upstream, "https://gw.test/a2a/agent")
	assert.Equal(t, []any{map[string]any{"url": "https://gw.test/a2a/agent"}}, card["supportedInterfaces"])
}
