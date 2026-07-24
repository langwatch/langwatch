package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRouter_NonStreaming_HeartbeatKeepsRealSocketWarm is the one test that
// isn't in-process: every test in nonstreaming_ttfb_test.go drives the
// router through httptest.ResponseRecorder, an in-memory buffer that never
// proves bytes actually cross a real transport. This one puts the router
// behind httptest.NewServer (a real net/http.Server on a real loopback TCP
// port) and a real *http.Client, using httptrace to capture the client's
// actual GotFirstResponseByte — the same signal a real proxy in front of
// the gateway would be watching to decide whether the connection has gone
// idle. If chunked-transfer framing or flush semantics only worked inside
// Go's in-memory recorder abstraction and not over a real socket, this is
// the test that would catch it.
func TestRouter_NonStreaming_HeartbeatKeepsRealSocketWarm(t *testing.T) {
	providerEntered := make(chan struct{})
	releaseProvider := make(chan struct{})
	router := newHeartbeatRouter(slowSuccessProvider(providerEntered, releaseProvider), 20*time.Millisecond)

	srv := httptest.NewServer(router)
	defer srv.Close()

	var mu sync.Mutex
	var firstByteAt time.Time
	trace := &httptrace.ClientTrace{
		GotFirstResponseByte: func() {
			mu.Lock()
			firstByteAt = time.Now()
			mu.Unlock()
		},
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(chatBody()))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

	start := time.Now()
	type result struct {
		resp *http.Response
		err  error
	}
	resultCh := make(chan result, 1)
	go func() {
		resp, err := http.DefaultClient.Do(req)
		resultCh <- result{resp, err}
	}()

	waitOrFatal(t, providerEntered, "provider was never dialed")

	// Poll instead of a fixed sleep — a hardcoded wait is either too short
	// (flakes on a loaded CI runner) or wastes time on a fast one.
	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return !firstByteAt.IsZero()
	}, 2*time.Second, 5*time.Millisecond,
		"a real HTTP client on a real socket should see GotFirstResponseByte from a heartbeat before the still-in-flight provider call returns")

	mu.Lock()
	elapsed := firstByteAt.Sub(start)
	mu.Unlock()
	assert.Less(t, elapsed, 500*time.Millisecond,
		"the first byte over the real socket should arrive within a couple heartbeat ticks, not only once the provider call eventually returns")

	close(releaseProvider)

	var res result
	select {
	case res = <-resultCh:
	case <-time.After(2 * time.Second):
		t.Fatal("real HTTP client never received a response")
	}
	require.NoError(t, res.err)
	defer res.resp.Body.Close()

	body, err := io.ReadAll(res.resp.Body)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, res.resp.StatusCode)
	assert.Contains(t, string(body), "choices")
	assert.Equal(t, "true", res.resp.Header.Get("X-LangWatch-Heartbeat-Active"))
}
