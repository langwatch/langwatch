package a2aproxy

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// stallTimeout is the body timeout these tests set; stallWait is how long
// they let the gateway take to give up, far past it.
const (
	stallTimeout = 50 * time.Millisecond
	stallWait    = 5 * time.Second
)

// @scenario "a body that stops arriving is refused, not waited on"
func TestStalledRequestBodyIsRefused(t *testing.T) {
	f := newFixture(t)
	gw := httptest.NewServer(New(Config{
		Registry:           f.registry,
		Bundle:             func(context.Context) *domain.Bundle { return f.bundle },
		Client:             f.upstream.Client(),
		PublicBaseURL:      testPublicBaseURL,
		RequestBodyTimeout: stallTimeout,
	}))
	t.Cleanup(gw.Close)
	conn, err := net.Dial("tcp", gw.Listener.Addr().String())
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })

	_, err = io.WriteString(conn, "POST /a2a/billing/message:send HTTP/1.1\r\nHost: gw.acme.test\r\n"+
		"Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"message\":")
	require.NoError(t, err)
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(stallWait)))
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	require.NoError(t, err, "the gateway answers a stalled body instead of waiting for the rest")
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, string(body), `"reason":"a2a_invalid_request"`)
	assert.Empty(t, f.upstreamCalls())
}

// @scenario "a body that stops arriving is refused, not waited on"
func TestStalledReplyBodyIsRefused(t *testing.T) {
	for name, path := range map[string]string{
		"call":       "/a2a/billing",
		"Agent Card": cardPathOnTheGateway,
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			release := make(chan struct{})
			t.Cleanup(func() { close(release) })
			f.reply = func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"jsonrpc":"2.0",`)
				w.(http.Flusher).Flush()
				select {
				case <-r.Context().Done():
				case <-release:
				}
			}
			method, body := http.MethodPost, sendMessage("SendMessage", "hi")
			if path == cardPathOnTheGateway {
				method, body = http.MethodGet, ""
			}
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() { done <- f.doWith(Config{ReplyBodyTimeout: stallTimeout}, method, path, body) }()

			select {
			case rec := <-done:
				assert.Contains(t, rec.Body.String(), `"a2a_upstream_unreachable"`)
			case <-time.After(stallWait):
				t.Fatal("the gateway kept waiting for a reply body that stopped arriving")
			}
		})
	}
}
