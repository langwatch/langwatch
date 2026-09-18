package otelrelay

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strconv"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
)

// The coding agent runs with its own retry off (services/langyworker/src/session.ts),
// so a burst rate limit, tokens per minute on a small deployment while a
// guided turn carries the whole skill, would end the turn on its first 429.
// The relay sees the response before the agent does and is the one place that
// reads Retry-After, so it re-sends the call itself: a couple of bounded
// attempts inside the same call, the wait taken from the provider when it
// names one. Then the 429 passes through and the cut logic in llmproxy.go
// applies to it as before.
const (
	// llmRateLimitRetries is how many times one call is re-sent after a 429.
	llmRateLimitRetries = 2
	// llmRetryMaxWait bounds one wait: a provider asking for longer is not
	// retried, the call fails now and the panel says to wait.
	llmRetryMaxWait = 30 * time.Second
)

// llmRetryFallbackWaits are the waits when the provider names none.
var llmRetryFallbackWaits = [llmRateLimitRetries]time.Duration{2 * time.Second, 4 * time.Second}

// llmRetryMaxBody bounds the request body held for a re-send. A larger body
// is streamed once and never retried. A var so a test can lower it.
var llmRetryMaxBody int64 = 8 << 20

// llmRetrySleep waits out one backoff, or the call's own context. A var so
// tests run without the wait.
var llmRetrySleep = func(ctx context.Context, wait time.Duration) error {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// llmRetryTransport is the reverse proxy's transport for one mediated call.
type llmRetryTransport struct {
	base  http.RoundTripper
	relay *Relay
	entry *workerEntry
}

func (r *Relay) llmRetryTransport(entry *workerEntry) http.RoundTripper {
	return &llmRetryTransport{base: http.DefaultTransport, relay: r, entry: entry}
}

// RoundTrip sends the call, and re-sends it after a burst 429 up to
// llmRateLimitRetries times. Anything but a 429, a hard limit, a wait past
// the bound, and a body too large to hold all pass through on the first
// answer.
func (t *llmRetryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	body, replayable, err := bufferForReplay(req)
	if err != nil {
		return nil, err
	}
	if !replayable {
		return t.base.RoundTrip(req)
	}
	for attempt := 0; ; attempt++ {
		req.Body = io.NopCloser(bytes.NewReader(body))
		resp, err := t.base.RoundTrip(req)
		if err != nil || resp.StatusCode != http.StatusTooManyRequests || attempt >= llmRateLimitRetries {
			return resp, err
		}
		wait, ok := t.retryWait(resp, attempt)
		if !ok {
			return resp, nil
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if err := llmRetrySleep(req.Context(), wait); err != nil {
			return nil, err
		}
	}
}

// bufferForReplay reads the request body so it can be sent again. A body
// past llmRetryMaxBody is put back in front of its unread remainder and
// reported as not replayable.
func bufferForReplay(req *http.Request) (body []byte, replayable bool, err error) {
	if req.Body == nil || req.Body == http.NoBody {
		return nil, true, nil
	}
	held, err := io.ReadAll(io.LimitReader(req.Body, llmRetryMaxBody+1))
	if err != nil {
		return nil, false, err
	}
	if int64(len(held)) > llmRetryMaxBody {
		rest := req.Body
		req.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(held), rest), rest}
		return nil, false, nil
	}
	_ = req.Body.Close()
	return held, true, nil
}

// retryWait decides whether this 429 is retried and how long to wait first.
// The body is peeked for the hard-limit discriminants and put back untouched.
func (t *llmRetryTransport) retryWait(resp *http.Response, attempt int) (time.Duration, bool) {
	peeked, err := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
	rest := resp.Body
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(peeked), rest), rest}
	if err != nil {
		return 0, false
	}
	e, _ := decodeLLMErrorBody(peeked, upstreamResponse{
		handledCode: resp.Header.Get(herr.HandledErrorHeader),
		status:      resp.StatusCode,
		contentType: resp.Header.Get("Content-Type"),
	})
	if hasHardLimitReason(e) {
		return 0, false
	}
	wait, named := retryAfterWait(resp.Header)
	if !named {
		wait = llmRetryFallbackWaits[attempt]
	}
	if wait > llmRetryMaxWait {
		t.logRetry(attempt+1, wait, "past the bound, not retried")
		return 0, false
	}
	t.logRetry(attempt+1, wait, "retried")
	return wait, true
}

func (t *llmRetryTransport) logRetry(attempt int, wait time.Duration, outcome string) {
	clog.Get(t.relay.baseCtx).Info("otelrelay llm rate limit retry",
		zap.String("conversation", t.entry.info.ConversationID),
		zap.Int("attempt", attempt),
		zap.Int("of", llmRateLimitRetries),
		zap.Duration("wait", wait),
		zap.String("outcome", outcome))
}

// retryAfterWait reads the wait a provider names: retry-after-ms (OpenAI's
// millisecond form), then Retry-After as seconds or as an HTTP date.
func retryAfterWait(h http.Header) (time.Duration, bool) {
	if ms := h.Get("retry-after-ms"); ms != "" {
		if n, err := strconv.Atoi(ms); err == nil && n >= 0 {
			return time.Duration(n) * time.Millisecond, true
		}
	}
	value := h.Get("Retry-After")
	if value == "" {
		return 0, false
	}
	if n, err := strconv.Atoi(value); err == nil && n >= 0 {
		return time.Duration(n) * time.Second, true
	}
	if at, err := http.ParseTime(value); err == nil {
		wait := time.Until(at)
		if wait < 0 {
			wait = 0
		}
		return wait, true
	}
	return 0, false
}
