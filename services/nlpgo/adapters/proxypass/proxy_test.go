package proxypass_test

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/adapters/proxypass"
)

// TestReverseProxy_SSE_StreamsChunksUnbuffered is the test that should
// have existed before we claimed nlpgo could front-door the legacy
// /studio/* SSE path. It stands up a fake-uvicorn upstream that emits
// SSE chunks separated by ~100ms gaps, points proxypass at it, and
// asserts each chunk arrives at the client AS IT IS WRITTEN — not
// buffered into one blob at the end.
//
// FlushInterval=-1 in proxypass.New is what makes this work; flipping
// to any other value (default 0 means "no automatic flushing") fails
// this test by delivering all chunks together when the upstream finishes.
func TestReverseProxy_SSE_StreamsChunksUnbuffered(t *testing.T) {
	chunks := []string{
		"event: state_change\ndata: {\"node\":\"entry\",\"status\":\"running\"}\n\n",
		"event: state_change\ndata: {\"node\":\"entry\",\"status\":\"success\"}\n\n",
		"event: state_change\ndata: {\"node\":\"end\",\"status\":\"running\"}\n\n",
		"event: done\ndata: {\"status\":\"success\"}\n\n",
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		require.True(t, ok, "test upstream must support flushing")
		for _, c := range chunks {
			_, _ = w.Write([]byte(c))
			flusher.Flush()
			time.Sleep(80 * time.Millisecond)
		}
	}))
	defer upstream.Close()

	proxy, err := proxypass.New(proxypass.Options{UpstreamURL: upstream.URL})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	resp, err := http.Get(front.URL + "/studio/execute")
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Header.Get("Content-Type"), "text/event-stream")

	// Read frame-by-frame and record arrival timestamps. Each frame is
	// "event: TYPE\ndata: ...\n\n" so we look for the blank-line
	// separator. With FlushInterval=-1 the gap between consecutive
	// arrivals should reflect the upstream's ~80ms sleeps.
	br := bufio.NewReader(resp.Body)
	var arrivals []time.Time
	var frames []string
	var buf bytes.Buffer
	for {
		line, err := br.ReadString('\n')
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		buf.WriteString(line)
		if line == "\n" || line == "\r\n" {
			arrivals = append(arrivals, time.Now())
			frames = append(frames, buf.String())
			buf.Reset()
			if len(frames) == len(chunks) {
				break
			}
		}
	}

	require.Len(t, frames, len(chunks), "expected one frame per upstream chunk")
	for i, c := range chunks {
		assert.Equal(t, c, frames[i], "frame %d should be byte-equivalent to upstream", i)
	}

	// Verify chunks did not all arrive at once (i.e. proxy is not
	// buffering until upstream completes). The last arrival should be
	// at least 200ms after the first if streaming is honored.
	gap := arrivals[len(arrivals)-1].Sub(arrivals[0])
	assert.Greater(t, gap.Milliseconds(), int64(150),
		"frames arrived too close together — proxypass appears to be buffering. gap=%s", gap)
}

// TestReverseProxy_PreservesUpstreamHeaders verifies that the
// SSE-relevant response headers (Content-Type, Cache-Control) are
// passed through unchanged, plus the X-LangWatch-NLPGO-Proxy=1 hint
// the proxypass adds for log-correlation.
func TestReverseProxy_PreservesUpstreamHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "1", r.Header.Get("X-LangWatch-NLPGO-Proxy"))
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Custom-Upstream", "yes")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "event: x\ndata: {}\n\n")
	}))
	defer upstream.Close()

	proxy, err := proxypass.New(proxypass.Options{UpstreamURL: upstream.URL})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	resp, err := http.Get(front.URL + "/studio/execute")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Contains(t, resp.Header.Get("Content-Type"), "text/event-stream")
	assert.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
	assert.Equal(t, "yes", resp.Header.Get("X-Custom-Upstream"))
}

// TestReverseProxy_ClientCancelPropagatesUpstream verifies that when
// the client closes its connection mid-stream, proxypass also closes
// the upstream — so an in-flight Studio run on uvicorn knows to
// stop wasting resources. Without this, a customer who navigates
// away in the middle of a slow workflow leaves uvicorn churning.
func TestReverseProxy_ClientCancelPropagatesUpstream(t *testing.T) {
	upstreamSeen := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "event: hi\ndata: {}\n\n")
		flusher.Flush()
		// Stay open until the request ctx is done — should fire when
		// the client disconnects.
		<-r.Context().Done()
		upstreamSeen <- struct{}{}
	}))
	defer upstream.Close()

	proxy, err := proxypass.New(proxypass.Options{UpstreamURL: upstream.URL})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, front.URL+"/studio/execute", nil)
	require.NoError(t, err)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	// Read the first chunk to confirm streaming has started, then bail.
	br := bufio.NewReader(resp.Body)
	for {
		line, _ := br.ReadString('\n')
		if line == "\n" || line == "\r\n" {
			break
		}
	}
	cancel()
	_ = resp.Body.Close()

	select {
	case <-upstreamSeen:
		// upstream observed cancellation — good
	case <-time.After(3 * time.Second):
		t.Fatal("upstream never observed client cancellation; proxypass did not propagate context cancel")
	}
}

// TestReverseProxy_UpstreamUnreachable_Returns502 verifies the error
// path: when uvicorn is down (or wrong URL), proxypass returns 502
// with a clean message rather than leaking a connection-refused error
// or hanging.
func TestReverseProxy_UpstreamUnreachable_Returns502(t *testing.T) {
	// 127.0.0.1:1 is reserved and never listens.
	proxy, err := proxypass.New(proxypass.Options{UpstreamURL: "http://127.0.0.1:1"})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	resp, err := http.Get(front.URL + "/studio/execute")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusBadGateway, resp.StatusCode)
	body, _ := io.ReadAll(resp.Body)
	assert.Contains(t, strings.ToLower(string(body)), "upstream")
}

// TestReverseProxy_ForwardsMethodAndPath ensures the proxy doesn't
// rewrite the URL path or method on the way to uvicorn. A mistaken
// rewrite would silently break Python's /studio/execute_sync POST
// when nlpgo is the entry.
func TestReverseProxy_ForwardsMethodAndPath(t *testing.T) {
	var got struct {
		method string
		path   string
		body   string
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got.method = r.Method
		got.path = r.URL.Path
		got.body = string(body)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer upstream.Close()

	proxy, err := proxypass.New(proxypass.Options{UpstreamURL: upstream.URL})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{"POST", "/studio/execute_sync", `{"trace":"x"}`},
		{"GET", "/health", ""},
		{"POST", "/topics/batch_clustering", `{"records":[]}`},
		{"POST", "/proxy/v1/chat/completions", `{"model":"gpt-5-mini"}`},
	} {
		t.Run(fmt.Sprintf("%s %s", tc.method, tc.path), func(t *testing.T) {
			req, err := http.NewRequest(tc.method, front.URL+tc.path, strings.NewReader(tc.body))
			require.NoError(t, err)
			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			_ = resp.Body.Close()
			assert.Equal(t, tc.method, got.method)
			assert.Equal(t, tc.path, got.path)
			assert.Equal(t, tc.body, got.body)
		})
	}
}
