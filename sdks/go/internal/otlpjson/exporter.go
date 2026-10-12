package otlpjson

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"syscall"
	"time"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// ContentType is the media type of an OTLP/JSON body. The LangWatch receiver
// compares it verbatim, so no charset parameter is appended.
const ContentType = "application/json"

// DefaultTimeout bounds one HTTP attempt when Config.HTTPClient is nil,
// matching the official OTLP exporter's 10s default.
const DefaultTimeout = 10 * time.Second

// maxErrorBody caps how much of a refusal body is quoted in an error.
const maxErrorBody = 512

// ErrShutdown is returned by ExportSpans after Shutdown.
var ErrShutdown = errors.New("otlpjson: exporter is shut down")

// Config configures an Exporter.
type Config struct {
	// URL is the full OTLP traces URL, e.g. https://app.langwatch.ai/api/otel/v1/traces.
	URL string
	// Headers are sent with every request (auth, SDK identification).
	Headers map[string]string
	// HTTPClient sends the requests. Nil uses a client with DefaultTimeout.
	HTTPClient *http.Client
	// DisableCompression sends the body uncompressed instead of gzipped.
	DisableCompression bool
	// Retry controls retries of throttled (429) and unavailable (502/503/504) exports.
	Retry RetryConfig
}

// Exporter is an sdktrace.SpanExporter that posts OTLP/JSON over HTTP. It is
// safe for concurrent use; batching is left to sdktrace.BatchSpanProcessor.
type Exporter struct {
	url         string
	headers     map[string]string
	client      *http.Client
	ownsClient  bool // the client was created here, so Shutdown may close it
	compression bool
	retry       RetryConfig

	mu       sync.RWMutex
	shutdown bool
	stop     context.CancelFunc // cancels stopped, ending in-flight exports
	stopped  context.Context
	inflight sync.WaitGroup
}

var _ sdktrace.SpanExporter = (*Exporter)(nil)

// New returns an Exporter for cfg. Zero retry fields take the defaults
// documented on RetryConfig.
func New(cfg Config) *Exporter {
	client, owns := cfg.HTTPClient, false
	if client == nil {
		client, owns = &http.Client{Timeout: DefaultTimeout}, true
	}
	headers := make(map[string]string, len(cfg.Headers))
	for k, v := range cfg.Headers {
		headers[k] = v
	}
	stopped, stop := context.WithCancelCause(context.Background())
	return &Exporter{
		stopped:     stopped,
		stop:        func() { stop(ErrShutdown) },
		url:         cfg.URL,
		headers:     headers,
		client:      client,
		ownsClient:  owns,
		compression: !cfg.DisableCompression,
		retry:       cfg.Retry.withDefaults(),
	}
}

// ExportSpans encodes spans and posts them, retrying throttled and failed
// attempts with backoff until the retry budget or ctx runs out.
func (e *Exporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	e.mu.RLock()
	if e.shutdown {
		e.mu.RUnlock()
		return ErrShutdown
	}
	e.inflight.Add(1) // under the lock, so Shutdown's Wait sees it
	e.mu.RUnlock()
	defer e.inflight.Done()
	if len(spans) == 0 {
		return nil
	}

	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	defer context.AfterFunc(e.stopped, func() { cancel(ErrShutdown) })()

	payload, err := e.encode(spans)
	if err != nil {
		return fmt.Errorf("otlpjson: encoding spans: %w", err)
	}
	encoding := ""
	if e.compression {
		encoding = "gzip"
	}

	return e.retry.do(ctx, func(ctx context.Context) error {
		return e.send(ctx, payload, encoding)
	})
}

// Shutdown refuses further exports, cancels in-flight ones (their retries
// included) and waits for them to return, bounded by ctx. It is idempotent.
func (e *Exporter) Shutdown(ctx context.Context) error {
	e.mu.Lock()
	e.shutdown = true
	e.mu.Unlock()
	e.stop()

	done := make(chan struct{})
	go func() {
		e.inflight.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	if e.ownsClient {
		e.client.CloseIdleConnections()
	}
	return nil
}

// send performs one HTTP attempt. A retryable failure is returned as a
// *retryableError so the retry loop can honour Retry-After.
func (e *Exporter) send(ctx context.Context, payload []byte, encoding string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	for k, v := range e.headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", ContentType)
	if encoding != "" {
		req.Header.Set("Content-Encoding", encoding)
	}

	resp, err := e.client.Do(req)
	if err != nil {
		if cause := context.Cause(ctx); cause != nil {
			return cause
		}
		if isTransientNetworkError(err) {
			return &retryableError{err: err}
		}
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		reportPartialSuccess(body)
		return nil
	case isRetryableStatus(resp.StatusCode):
		return &retryableError{
			err:        httpStatusError(resp, body),
			retryAfter: parseRetryAfter(resp.Header.Get("Retry-After"), time.Now()),
		}
	default:
		return httpStatusError(resp, body)
	}
}

// isRetryableStatus reports whether an export answered with code is worth
// resending. It is the otlptracehttp set: throttling and the gateway errors.
func isRetryableStatus(code int) bool {
	switch code {
	case http.StatusTooManyRequests, http.StatusBadGateway,
		http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

// isTransientNetworkError reports whether a failed request may succeed when
// resent: what otlptracehttp retries (url.Error.Temporary, timeouts included)
// plus a connection refused, reset or dropped mid-request. A bad URL, a TLS
// verification failure or a refused redirect is permanent.
func isTransientNetworkError(err error) bool {
	var urlErr *url.Error
	if errors.As(err, &urlErr) && (urlErr.Temporary() || urlErr.Timeout()) {
		return true
	}
	return errors.Is(err, syscall.ECONNREFUSED) ||
		errors.Is(err, syscall.ECONNRESET) ||
		errors.Is(err, syscall.ECONNABORTED) ||
		errors.Is(err, syscall.EPIPE) ||
		errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.Is(err, io.EOF)
}

func httpStatusError(resp *http.Response, body []byte) error {
	if len(body) > maxErrorBody {
		body = body[:maxErrorBody]
	}
	return fmt.Errorf("otlpjson: export failed with %s: %s", resp.Status, bytes.TrimSpace(body))
}

// reportPartialSuccess surfaces spans the receiver accepted the request for
// but rejected, through the global OpenTelemetry error handler, as the
// official exporter does.
func reportPartialSuccess(body []byte) {
	if len(body) == 0 {
		return
	}
	var answer struct {
		PartialSuccess struct {
			RejectedSpans json.Number `json:"rejectedSpans"`
			ErrorMessage  string      `json:"errorMessage"`
		} `json:"partialSuccess"`
	}
	if json.Unmarshal(body, &answer) != nil {
		return
	}
	ps := answer.PartialSuccess
	rejected, _ := ps.RejectedSpans.Int64()
	if rejected > 0 || ps.ErrorMessage != "" {
		otel.Handle(fmt.Errorf("otlpjson: partial success: %d spans rejected: %s", rejected, ps.ErrorMessage))
	}
}

var gzipPool = sync.Pool{New: func() any { return gzip.NewWriter(io.Discard) }}

// encode streams the OTLP/JSON request into one buffer, through a pooled gzip
// writer when compression is on. The buffer is not pooled: the transport may
// still read a request body after Do returns.
func (e *Exporter) encode(spans []sdktrace.ReadOnlySpan) ([]byte, error) {
	var buf bytes.Buffer
	if !e.compression {
		if err := Encode(&buf, spans); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}

	zw := gzipPool.Get().(*gzip.Writer)
	defer func() {
		zw.Reset(io.Discard) // drop the reference to buf before pooling
		gzipPool.Put(zw)
	}()
	zw.Reset(&buf)
	if err := Encode(zw, spans); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
