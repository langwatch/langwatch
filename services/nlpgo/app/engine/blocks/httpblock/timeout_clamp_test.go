package httpblock_test

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

// silentServer answers nothing until the client gives up, so the only thing
// that can end a request against it is the executor's own deadline.
func silentServer(t *testing.T) (url string, host string) {
	t.Helper()
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		close(release)
		srv.Close()
	})
	h, _, _ := net.SplitHostPort(srv.Listener.Addr().String())
	return srv.URL + "/never", h
}

func silentExecutor(t *testing.T, host string, ceiling time.Duration) *httpblock.Executor {
	t.Helper()
	return httpblock.New(httpblock.Options{
		SSRF:           httpblock.SSRFOptions{AllowedHosts: []string{host}},
		DefaultTimeout: ceiling,
	})
}

// TestHTTPBlock_RequestTimeoutCannotExceedTheOperatorCeiling pins that a
// node's `timeout_ms` is a way to ask for LESS time than the deployment
// allows, never more. Options.DefaultTimeout carries
// NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS — the bound on how long one node may
// hold a worker waiting on a customer endpoint — so a larger number arriving
// from a workflow node must not win.
// @scenario "An HTTP node's timeout_ms cannot exceed the operator's ceiling"
func TestHTTPBlock_RequestTimeoutCannotExceedTheOperatorCeiling(t *testing.T) {
	url, host := silentServer(t)
	exec := silentExecutor(t, host, 200*time.Millisecond)

	start := time.Now()
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:       url,
		Method:    http.MethodGet,
		TimeoutMS: 30000,
	})
	elapsed := time.Since(start)

	require.Error(t, err)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Less(t, elapsed, 3*time.Second, "the ceiling, not the request, must decide")
}

// TestHTTPBlock_RequestTimeoutBelowTheCeilingIsHonored pins the other half:
// asking for less than the ceiling still shortens the call.
// @scenario "An HTTP node's timeout_ms below the ceiling is honored"
func TestHTTPBlock_RequestTimeoutBelowTheCeilingIsHonored(t *testing.T) {
	url, host := silentServer(t)
	exec := silentExecutor(t, host, 30*time.Second)

	start := time.Now()
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:       url,
		Method:    http.MethodGet,
		TimeoutMS: 200,
	})
	elapsed := time.Since(start)

	require.Error(t, err)
	assert.Less(t, elapsed, 3*time.Second)
}

// TestHTTPBlock_MissingRequestTimeoutUsesTheCeiling pins that a node with no
// `timeout_ms` at all runs under the operator's budget rather than none.
// @scenario "A missing HTTP timeout_ms falls back to the operator's ceiling"
func TestHTTPBlock_MissingRequestTimeoutUsesTheCeiling(t *testing.T) {
	url, host := silentServer(t)
	exec := silentExecutor(t, host, 200*time.Millisecond)

	start := time.Now()
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:    url,
		Method: http.MethodGet,
	})
	elapsed := time.Since(start)

	require.Error(t, err)
	assert.Less(t, elapsed, 3*time.Second)
}
