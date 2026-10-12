package otlpjson

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// received is one request as the test server saw it.
type received struct {
	header http.Header
	body   decoded
}

// recorder is an OTLP/JSON receiver answering with the next scripted status.
type recorder struct {
	t        *testing.T
	mu       sync.Mutex
	requests []received
	statuses []int
	headers  []map[string]string
	calls    atomic.Int32
}

func (r *recorder) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	n := int(r.calls.Add(1)) - 1

	var body io.Reader = req.Body
	if req.Header.Get("Content-Encoding") == "gzip" {
		zr, err := gzip.NewReader(req.Body)
		if !assert.NoError(r.t, err) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		body = zr
	}
	var payload decoded
	assert.NoError(r.t, json.NewDecoder(body).Decode(&payload))

	r.mu.Lock()
	r.requests = append(r.requests, received{header: req.Header.Clone(), body: payload})
	r.mu.Unlock()

	status := http.StatusOK
	if n < len(r.statuses) {
		status = r.statuses[n]
	}
	if n < len(r.headers) {
		for k, v := range r.headers[n] {
			w.Header().Set(k, v)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"message":"ok","partialSuccess":{"rejectedSpans":0,"errorMessage":""}}`))
}

func newTestExporter(t *testing.T, rec *recorder, mutate func(*Config)) *Exporter {
	t.Helper()
	rec.t = t
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	cfg := Config{
		URL:     srv.URL + "/api/otel/v1/traces",
		Headers: map[string]string{"Authorization": "Bearer sk-lw-test", "X-Project-Id": "project-1"},
		Retry: RetryConfig{
			InitialInterval: time.Millisecond,
			MaxInterval:     5 * time.Millisecond,
			MaxElapsedTime:  2 * time.Second,
		},
	}
	if mutate != nil {
		mutate(&cfg)
	}
	return New(cfg)
}

func oneSpan() []sdktrace.ReadOnlySpan {
	return []sdktrace.ReadOnlySpan{richSpan().Snapshot()}
}

func TestExporter_PostsGzippedOTLPJSONWithHeaders(t *testing.T) {
	rec := &recorder{}
	exp := newTestExporter(t, rec, nil)

	require.NoError(t, exp.ExportSpans(context.Background(), oneSpan()))

	require.Len(t, rec.requests, 1)
	got := rec.requests[0]
	assert.Equal(t, "application/json", got.header.Get("Content-Type"), "the receiver compares the media type verbatim")
	assert.Equal(t, "gzip", got.header.Get("Content-Encoding"))
	assert.Equal(t, "Bearer sk-lw-test", got.header.Get("Authorization"))
	assert.Equal(t, "project-1", got.header.Get("X-Project-Id"))
	assert.Equal(t, "llm.chat", path(t, got.body, "resourceSpans", 0, "scopeSpans", 0, "spans", 0, "name"))
}

func TestExporter_UncompressedWhenDisabled(t *testing.T) {
	rec := &recorder{}
	exp := newTestExporter(t, rec, func(c *Config) { c.DisableCompression = true })

	require.NoError(t, exp.ExportSpans(context.Background(), oneSpan()))

	require.Len(t, rec.requests, 1)
	assert.Empty(t, rec.requests[0].header.Get("Content-Encoding"))
	assert.NotNil(t, rec.requests[0].body["resourceSpans"])
}

func TestExporter_RetriesThrottlingAndServerErrors(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			rec := &recorder{statuses: []int{status, status, http.StatusOK}}
			exp := newTestExporter(t, rec, nil)

			require.NoError(t, exp.ExportSpans(context.Background(), oneSpan()))
			assert.EqualValues(t, 3, rec.calls.Load())
			for _, r := range rec.requests {
				assert.NotNil(t, r.body["resourceSpans"], "every attempt resends the full body")
			}
		})
	}
}

func TestExporter_DoesNotRetryOtherStatuses(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusInternalServerError, http.StatusNotImplemented} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			rec := &recorder{statuses: []int{status}}
			exp := newTestExporter(t, rec, nil)

			err := exp.ExportSpans(context.Background(), oneSpan())
			require.Error(t, err)
			assert.Contains(t, err.Error(), http.StatusText(status))
			assert.EqualValues(t, 1, rec.calls.Load())
		})
	}
}

func TestExporter_HonoursRetryAfter(t *testing.T) {
	rec := &recorder{
		statuses: []int{http.StatusTooManyRequests},
		headers:  []map[string]string{{"Retry-After": "1"}},
	}
	exp := newTestExporter(t, rec, nil)

	start := time.Now()
	require.NoError(t, exp.ExportSpans(context.Background(), oneSpan()))
	assert.GreaterOrEqual(t, time.Since(start), time.Second, "the server's wait outranks the shorter backoff")
	assert.EqualValues(t, 2, rec.calls.Load())
}

func TestExporter_GivesUpWhenBudgetExhausted(t *testing.T) {
	rec := &recorder{statuses: []int{503, 503, 503, 503, 503, 503, 503, 503, 503, 503}}
	exp := newTestExporter(t, rec, func(c *Config) {
		c.Retry = RetryConfig{InitialInterval: 20 * time.Millisecond, MaxInterval: 20 * time.Millisecond, MaxElapsedTime: 50 * time.Millisecond}
	})

	err := exp.ExportSpans(context.Background(), oneSpan())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "retry budget")
	assert.Less(t, int(rec.calls.Load()), 10)
}

func TestExporter_StopsRetryingWhenContextEnds(t *testing.T) {
	rec := &recorder{statuses: []int{503, 503, 503, 503, 503, 503, 503, 503, 503, 503}}
	exp := newTestExporter(t, rec, func(c *Config) {
		c.Retry = RetryConfig{InitialInterval: time.Second, MaxElapsedTime: time.Minute}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := exp.ExportSpans(ctx, oneSpan())
	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.EqualValues(t, 1, rec.calls.Load())
}

func TestExporter_RetriesRefusedConnection(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close() // nothing listens on the port any more
	exp := New(Config{
		URL:   url,
		Retry: RetryConfig{InitialInterval: time.Millisecond, MaxInterval: time.Millisecond, MaxElapsedTime: 50 * time.Millisecond},
	})

	err := exp.ExportSpans(context.Background(), oneSpan())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "retry budget", "a refused connection is transient")
}

func TestExporter_DoesNotRetryPermanentNetworkErrors(t *testing.T) {
	tlsSrv := httptest.NewTLSServer(http.NotFoundHandler())
	t.Cleanup(tlsSrv.Close)
	redirects := httptest.NewServer(http.RedirectHandler("/elsewhere", http.StatusTemporaryRedirect))
	t.Cleanup(redirects.Close)
	noRedirects := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("redirects are refused")
	}}

	for name, cfg := range map[string]Config{
		"unsupported scheme":      {URL: "ftp://example.test/v1/traces"},
		"untrusted certificate":   {URL: tlsSrv.URL},
		"refused redirect":        {URL: redirects.URL, HTTPClient: noRedirects},
		"unparseable request url": {URL: "http://[::1"},
	} {
		t.Run(name, func(t *testing.T) {
			cfg.Retry = RetryConfig{InitialInterval: time.Second, MaxElapsedTime: time.Minute}
			start := time.Now()
			require.Error(t, New(cfg).ExportSpans(context.Background(), oneSpan()))
			assert.Less(t, time.Since(start), time.Second, "a permanent error is not retried")
		})
	}
}

func TestExporter_RetryDisabledSendsOnce(t *testing.T) {
	rec := &recorder{statuses: []int{503}}
	exp := newTestExporter(t, rec, func(c *Config) { c.Retry.Disabled = true })

	require.Error(t, exp.ExportSpans(context.Background(), oneSpan()))
	assert.EqualValues(t, 1, rec.calls.Load())
}

func TestExporter_EmptyBatchSendsNothing(t *testing.T) {
	rec := &recorder{}
	exp := newTestExporter(t, rec, nil)

	require.NoError(t, exp.ExportSpans(context.Background(), nil))
	assert.EqualValues(t, 0, rec.calls.Load())
}

func TestExporter_RefusesAfterShutdown(t *testing.T) {
	rec := &recorder{}
	exp := newTestExporter(t, rec, nil)

	require.NoError(t, exp.Shutdown(context.Background()))
	require.NoError(t, exp.Shutdown(context.Background()), "shutdown is idempotent")
	assert.ErrorIs(t, exp.ExportSpans(context.Background(), oneSpan()), ErrShutdown)
	assert.EqualValues(t, 0, rec.calls.Load())
}

// idleTracker records whether CloseIdleConnections reached the transport.
type idleTracker struct {
	http.RoundTripper
	closed atomic.Bool
}

func (t *idleTracker) CloseIdleConnections() { t.closed.Store(true) }

func TestExporter_ShutdownLeavesACallerClientOpen(t *testing.T) {
	tracker := &idleTracker{RoundTripper: http.DefaultTransport}
	exp := New(Config{URL: "http://example.test", HTTPClient: &http.Client{Transport: tracker}})

	require.NoError(t, exp.Shutdown(context.Background()))
	assert.False(t, tracker.closed.Load(), "a shared client's pool belongs to the caller")
}

func TestExporter_UnderBatchSpanProcessor(t *testing.T) {
	rec := &recorder{}
	exp := newTestExporter(t, rec, nil)
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp))

	tracer := tp.Tracer("batch-test")
	for _, name := range []string{"one", "two", "three"} {
		_, span := tracer.Start(context.Background(), name)
		span.End()
	}
	require.NoError(t, tp.ForceFlush(context.Background()))
	require.NoError(t, tp.Shutdown(context.Background()))

	var names []any
	for _, r := range rec.requests {
		for _, sp := range path(t, r.body, "resourceSpans", 0, "scopeSpans", 0, "spans").([]any) {
			names = append(names, sp.(map[string]any)["name"])
		}
	}
	assert.ElementsMatch(t, []any{"one", "two", "three"}, names)
}

func TestParseRetryAfter(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	assert.Equal(t, 3*time.Second, parseRetryAfter("3", now))
	assert.Equal(t, 10*time.Second, parseRetryAfter(now.Add(10*time.Second).Format(http.TimeFormat), now))
	assert.Zero(t, parseRetryAfter("", now))
	assert.Zero(t, parseRetryAfter("-1", now))
	assert.Zero(t, parseRetryAfter("soon", now))
	assert.Zero(t, parseRetryAfter(now.Add(-time.Second).Format(http.TimeFormat), now))
}
