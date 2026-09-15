package otelrelay

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// The retry's waits are recorded instead of slept, for every test in the
// package: the rate-limit cut tests answer 429 with a Retry-After too, and
// they would otherwise wait it out on every call.
var (
	retrySleepsMu sync.Mutex
	retrySleeps   []time.Duration
)

func init() {
	llmRetrySleep = func(ctx context.Context, wait time.Duration) error {
		retrySleepsMu.Lock()
		retrySleeps = append(retrySleeps, wait)
		retrySleepsMu.Unlock()
		return ctx.Err()
	}
}

func recordedRetrySleeps() []time.Duration {
	retrySleepsMu.Lock()
	defer retrySleepsMu.Unlock()
	return append([]time.Duration(nil), retrySleeps...)
}

func resetRetrySleeps() {
	retrySleepsMu.Lock()
	retrySleeps = nil
	retrySleepsMu.Unlock()
}

// rateLimitOnceGateway answers 429 with the given headers until `until` calls
// were seen, then 200. It records every request body it read.
type rateLimitOnceGateway struct {
	srv    *httptest.Server
	calls  atomic.Int32
	bodies []string
	mu     sync.Mutex
}

func newRateLimitOnceGateway(t *testing.T, headers http.Header, until int32) *rateLimitOnceGateway {
	t.Helper()
	g := &rateLimitOnceGateway{}
	g.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		raw, _ := io.ReadAll(req.Body)
		g.mu.Lock()
		g.bodies = append(g.bodies, string(raw))
		g.mu.Unlock()
		n := g.calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if n <= until {
			for key, values := range headers {
				w.Header()[key] = values
			}
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(rateLimitBurstBody))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(g.srv.Close)
	return g
}

func retryCall(t *testing.T, relay *Relay, token string) *http.Response {
	t.Helper()
	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{"model":"gpt-4o","messages":[]}`))
	if err != nil {
		t.Fatalf("proxied LLM call: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// @scenario "A rate-limited call is re-sent by the relay after the provider's Retry-After"
func TestLLMRetry_RetryAfterThenSuccess(t *testing.T) {
	resetRetrySleeps()
	gateway := newRateLimitOnceGateway(t, http.Header{"Retry-After": {"1"}}, 1)
	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-retry", GatewayBaseURL: gateway.srv.URL, LLMVirtualKey: "vk"})

	resp := retryCall(t, relay, token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("call answered %d, want 200 from the re-sent call", resp.StatusCode)
	}
	if got := gateway.calls.Load(); got != 2 {
		t.Fatalf("gateway saw %d calls, want 2: the first 429 and one re-send", got)
	}
	if gateway.bodies[0] != gateway.bodies[1] || gateway.bodies[0] == "" {
		t.Errorf("the re-sent body must be the original: got %q then %q", gateway.bodies[0], gateway.bodies[1])
	}
	if sleeps := recordedRetrySleeps(); len(sleeps) != 1 || sleeps[0] != time.Second {
		t.Errorf("waits = %v, want the provider's Retry-After of 1s", sleeps)
	}
	// A call that succeeded on the re-send leaves no captured cause behind.
	if _, ok := relay.LastLLMError(token); ok {
		t.Error("a successful re-send must clear the captured cause")
	}
}

// @scenario "A rate-limited call is re-sent by the relay after the provider's Retry-After"
func TestLLMRetry_MillisecondsAndFallbackWaits(t *testing.T) {
	resetRetrySleeps()
	gateway := newRateLimitOnceGateway(t, http.Header{"Retry-After-Ms": {"250"}}, 1)
	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-retry-ms", GatewayBaseURL: gateway.srv.URL, LLMVirtualKey: "vk"})
	if resp := retryCall(t, relay, token); resp.StatusCode != http.StatusOK {
		t.Fatalf("call answered %d, want 200", resp.StatusCode)
	}
	if sleeps := recordedRetrySleeps(); len(sleeps) != 1 || sleeps[0] != 250*time.Millisecond {
		t.Errorf("waits = %v, want retry-after-ms of 250ms", sleeps)
	}

	resetRetrySleeps()
	bare := newRateLimitOnceGateway(t, http.Header{}, 2)
	token2, _ := relay.Register(WorkerInfo{ConversationID: "conv-retry-bare", GatewayBaseURL: bare.srv.URL, LLMVirtualKey: "vk"})
	if resp := retryCall(t, relay, token2); resp.StatusCode != http.StatusOK {
		t.Fatalf("call answered %d, want 200 on the second re-send", resp.StatusCode)
	}
	if sleeps := recordedRetrySleeps(); len(sleeps) != 2 || sleeps[0] != 2*time.Second || sleeps[1] != 4*time.Second {
		t.Errorf("waits = %v, want the fallback 2s then 4s when the provider names none", sleeps)
	}
}

// @scenario "A rate limit that outlasts the relay's retries passes through"
func TestLLMRetry_ExhaustedPassesThrough(t *testing.T) {
	resetRetrySleeps()
	gateway := newRateLimitOnceGateway(t, http.Header{"Retry-After": {"2"}}, 99)
	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-retry-exhausted", GatewayBaseURL: gateway.srv.URL, LLMVirtualKey: "vk"})

	resp := retryCall(t, relay, token)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("call answered %d, want the 429 passed through once the retries are spent", resp.StatusCode)
	}
	if got := gateway.calls.Load(); got != 1+llmRateLimitRetries {
		t.Errorf("gateway saw %d calls, want %d: the call and its retries", got, 1+llmRateLimitRetries)
	}
	if resp.Header.Get("Retry-After") != "2" {
		t.Error("the passed-through 429 keeps its Retry-After for the cut logic and the capture")
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != rateLimitBurstBody {
		t.Errorf("the passed-through body was altered: %s", body)
	}
	if e, ok := relay.LastLLMError(token); !ok || e.Meta["http_status"] != http.StatusTooManyRequests {
		t.Errorf("the capture must name the 429 that passed through, got %v", e.Meta)
	}
}

// @scenario "A hard limit, a long Retry-After or a body too large to hold is not re-sent"
func TestLLMRetry_NotRetried(t *testing.T) {
	relay := startRelay(t)

	t.Run("a hard plan limit", func(t *testing.T) {
		resetRetrySleeps()
		var calls atomic.Int32
		gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			w.Header().Set("Retry-After", "1")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(rateLimitUsageLimitBody))
		}))
		defer gateway.Close()
		token, _ := relay.Register(WorkerInfo{ConversationID: "conv-retry-hard", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
		retryCall(t, relay, token)
		if got := calls.Load(); got != 1 {
			t.Errorf("gateway saw %d calls, want 1: a plan limit answers every re-send the same", got)
		}
		if sleeps := recordedRetrySleeps(); len(sleeps) != 0 {
			t.Errorf("waited %v before a hard limit, want no wait", sleeps)
		}
	})

	t.Run("a Retry-After past the bound", func(t *testing.T) {
		resetRetrySleeps()
		gateway := newRateLimitOnceGateway(t, http.Header{"Retry-After": {"600"}}, 1)
		token, _ := relay.Register(WorkerInfo{ConversationID: "conv-retry-long", GatewayBaseURL: gateway.srv.URL, LLMVirtualKey: "vk"})
		if resp := retryCall(t, relay, token); resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("call answered %d, want the 429 now rather than a ten minute wait", resp.StatusCode)
		}
		if got := gateway.calls.Load(); got != 1 {
			t.Errorf("gateway saw %d calls, want 1", got)
		}
		if sleeps := recordedRetrySleeps(); len(sleeps) != 0 {
			t.Errorf("waited %v, want none", sleeps)
		}
	})

	t.Run("a body too large to hold", func(t *testing.T) {
		resetRetrySleeps()
		was := llmRetryMaxBody
		llmRetryMaxBody = 8
		t.Cleanup(func() { llmRetryMaxBody = was })
		gateway := newRateLimitOnceGateway(t, http.Header{"Retry-After": {"1"}}, 1)
		token, _ := relay.Register(WorkerInfo{ConversationID: "conv-retry-large", GatewayBaseURL: gateway.srv.URL, LLMVirtualKey: "vk"})
		if resp := retryCall(t, relay, token); resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("call answered %d, want the 429 passed through", resp.StatusCode)
		}
		if got := gateway.calls.Load(); got != 1 {
			t.Errorf("gateway saw %d calls, want 1", got)
		}
		if gateway.bodies[0] != `{"model":"gpt-4o","messages":[]}` {
			t.Errorf("the body past the cap must still reach the gateway whole, got %q", gateway.bodies[0])
		}
	})
}

func TestRetryAfterWait(t *testing.T) {
	for _, tc := range []struct {
		name  string
		h     http.Header
		want  time.Duration
		named bool
	}{
		{name: "seconds", h: http.Header{"Retry-After": {"7"}}, want: 7 * time.Second, named: true},
		{name: "milliseconds win", h: http.Header{"Retry-After": {"7"}, "Retry-After-Ms": {"1500"}}, want: 1500 * time.Millisecond, named: true},
		{name: "http date in the past", h: http.Header{"Retry-After": {"Wed, 21 Oct 2015 07:28:00 GMT"}}, want: 0, named: true},
		{name: "absent", h: http.Header{}, want: 0, named: false},
		{name: "unreadable", h: http.Header{"Retry-After": {"soon"}}, want: 0, named: false},
	} {
		got, named := retryAfterWait(tc.h)
		if got != tc.want || named != tc.named {
			t.Errorf("%s: retryAfterWait = (%v, %v), want (%v, %v)", tc.name, got, named, tc.want, tc.named)
		}
	}
}
