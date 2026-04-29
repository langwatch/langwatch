package proxypass_test

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
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

// TestReverseProxy_UpstreamUnreachable_Returns503AfterWait verifies the
// cold-start fix: when uvicorn is unreachable, proxypass polls the
// upstream for ColdStartWait before giving up, then returns 503 with
// Retry-After:1 (not 502) so the AWS SDK's retryable-status logic
// kicks in instead of failing the user-visible request immediately.
//
// Pre-fix this test asserted 502 — the old behavior was correct for a
// permanently-down upstream but wrong during the Lambda cold-start
// window where the python child takes ~12-18s to import litellm. After
// the lifecycle reorder in PR #3559 binds $PORT immediately, requests
// can land while the child is still warming, and 502 surfaced as
// "Failed run workflow: 502 child upstream unavailable" in Studio
// (prod incident on 2026-04-28 19:xx UTC after saas#476 deploy). The
// 503 + Retry-After contract lets the LambdaClient retry transparently
// — see langwatch/src/optimization_studio/server/lambda/index.ts
// (maxAttempts:6, also from PR #3559).
func TestReverseProxy_UpstreamUnreachable_Returns503AfterWait(t *testing.T) {
	// 127.0.0.1:1 is reserved and never listens.
	proxy, err := proxypass.New(proxypass.Options{
		UpstreamURL: "http://127.0.0.1:1",
		// Tight wait so the test stays fast; production default is 90s.
		ColdStartWait:          200 * time.Millisecond,
		ColdStartProbeInterval: 50 * time.Millisecond,
		ColdStartProbeTimeout:  50 * time.Millisecond,
	})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	start := time.Now()
	resp, err := http.Get(front.URL + "/studio/execute")
	elapsed := time.Since(start)
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode,
		"unreachable upstream after the cold-start wait must surface as 503 (not 502) so the LambdaClient retries transparently")
	assert.Equal(t, "1", resp.Header.Get("Retry-After"),
		"503 must carry Retry-After:1 so the LambdaClient backs off briefly before retry")
	assert.GreaterOrEqual(t, elapsed, 200*time.Millisecond,
		"proxypass must wait the full ColdStartWait window before giving up")
}

// TestReverseProxy_NegativeColdStartWaitDisablesWait pins the
// documented contract that a NEGATIVE ColdStartWait disables the
// preamble entirely, so callers who want the legacy fail-fast
// behavior have a way to opt out without rewriting the proxy. Per
// the doc on Options.ColdStartWait, zero is the Go zero-value-is-
// default idiom (use the 90s default), and negative is the explicit
// "disabled" signal. With the wait disabled, an unreachable upstream
// returns 502 immediately from the existing ErrorHandler — same as
// the pre-cold-start-wait shape.
func TestReverseProxy_NegativeColdStartWaitDisablesWait(t *testing.T) {
	proxy, err := proxypass.New(proxypass.Options{
		UpstreamURL:   "http://127.0.0.1:1",
		ColdStartWait: -1, // explicit disable
	})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	start := time.Now()
	resp, err := http.Get(front.URL + "/studio/execute")
	elapsed := time.Since(start)
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusBadGateway, resp.StatusCode,
		"with ColdStartWait disabled, an unreachable upstream must surface as 502 immediately (not 503 after waiting)")
	assert.Less(t, elapsed, 500*time.Millisecond,
		"with the wait disabled, request should fail fast — got %s", elapsed)
}

// TestReverseProxy_NegativeProbeKnobsFallBackToDefaults pins the CR
// guard for misconfiguration: a negative ColdStartProbeInterval would
// make time.After fire instantly inside the retry loop and CPU-spin
// during outages; a negative ColdStartProbeTimeout would make every
// net.DialTimeout return immediately. Unlike ColdStartWait, neither
// probe knob has a "negative disables" sentinel — both must clamp to
// the default. Without this guard, negative values survive into the
// loop and the proxy degrades into a hot probe storm.
//
// Approach: same shape as TestReverseProxy_UpstreamReachableMidWait —
// upstream comes up after ~150ms — but we pass NEGATIVE probe knobs
// and a short ColdStartWait. If negatives clamp correctly, the loop
// runs at the 100ms default interval, sees the upstream a few probes
// in, and the request succeeds with 200. If negatives leak into the
// loop, the test would still pass functionally but the loop would
// CPU-spin during the warmup gap (not directly observable in unit
// tests; the production cost is wasted CPU on every cold-start).
// Functional correctness is what we pin here.
func TestReverseProxy_NegativeProbeKnobsFallBackToDefaults(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := probe.Addr().String()
	require.NoError(t, probe.Close())

	proxy, err := proxypass.New(proxypass.Options{
		UpstreamURL:            "http://" + addr,
		ColdStartWait:          1 * time.Second,
		ColdStartProbeInterval: -1 * time.Second, // negative, must clamp
		ColdStartProbeTimeout:  -1 * time.Second, // negative, must clamp
	})
	require.NoError(t, err,
		"New must accept negative probe knobs and clamp them; rejecting at startup would be a behavior regression")
	front := httptest.NewServer(proxy)
	defer front.Close()

	upstream := http.Server{
		Addr: addr,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
		ReadHeaderTimeout: time.Second,
	}
	defer func() { _ = upstream.Close() }()
	go func() {
		time.Sleep(150 * time.Millisecond)
		ln, lerr := net.Listen("tcp", addr)
		if lerr != nil {
			t.Errorf("delayed listen: %v", lerr)
			return
		}
		_ = upstream.Serve(ln)
	}()

	resp, err := http.Get(front.URL + "/studio/execute")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode,
		"with negative probe knobs clamped to defaults, the cold-start wait must still complete the request once the upstream comes up")
}

// TestReverseProxy_UpstreamReachableMidWaitProxiesThrough pins the
// happy cold-start path: when the upstream isn't reachable on the
// first probe but becomes reachable inside the wait window, the proxy
// polls until it sees the host, then proxies the request through.
// Without this behavior /studio/execute requests landing in the child
// warmup window would 503 even though the child becomes ready ~ms
// later — caller would have to retry an already-survivable request.
func TestReverseProxy_UpstreamReachableMidWaitProxiesThrough(t *testing.T) {
	// Reserve a free port; don't bind it yet. The proxy will see
	// connection-refused, wait, then succeed once we start the listener.
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := probe.Addr().String()
	require.NoError(t, probe.Close())

	proxy, err := proxypass.New(proxypass.Options{
		UpstreamURL:            "http://" + addr,
		ColdStartWait:          1 * time.Second,
		ColdStartProbeInterval: 30 * time.Millisecond,
		ColdStartProbeTimeout:  50 * time.Millisecond,
	})
	require.NoError(t, err)
	front := httptest.NewServer(proxy)
	defer front.Close()

	// Start the upstream after a short delay so the proxy sees a few
	// connection-refused probes before the host comes up.
	type observed struct {
		method, path string
	}
	hits := make(chan observed, 1)
	upstream := http.Server{
		Addr: addr,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			hits <- observed{r.Method, r.URL.Path}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		}),
		ReadHeaderTimeout: time.Second,
	}
	defer func() { _ = upstream.Close() }()
	upstreamReady := make(chan struct{})
	go func() {
		time.Sleep(150 * time.Millisecond) // simulate child warmup
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			t.Errorf("delayed listen: %v", err)
			close(upstreamReady)
			return
		}
		close(upstreamReady)
		_ = upstream.Serve(ln)
	}()

	resp, err := http.Get(front.URL + "/studio/execute")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode,
		"upstream became reachable inside ColdStartWait; proxypass must proxy through, not 503")

	select {
	case h := <-hits:
		assert.Equal(t, "/studio/execute", h.path)
	case <-time.After(2 * time.Second):
		t.Fatal("upstream never received the proxied request")
	}
	<-upstreamReady
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
