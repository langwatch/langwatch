package otlphttp

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"sync"
	"syscall"
	"time"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// ContentType is the media type of an OTLP/protobuf body.
const ContentType = "application/x-protobuf"

// DefaultTimeout bounds one HTTP attempt when Config.HTTPClient is nil,
// matching the official OTLP exporter's 10s default.
const DefaultTimeout = 10 * time.Second

// maxErrorBody caps how much of a refusal body is quoted in an error.
const maxErrorBody = 512

// ErrShutdown is returned by ExportSpans after Shutdown.
var ErrShutdown = errors.New("otlphttp: exporter is shut down")

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

// Exporter is an sdktrace.SpanExporter that posts OTLP/protobuf over HTTP. It is
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
		return fmt.Errorf("otlphttp: encoding spans: %w", err)
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
// *retryableError so the retry loop can honor Retry-After.
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
		reportPartialSuccess(resp.Header.Get("Content-Type"), body)
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
	return fmt.Errorf("otlphttp: export failed with %s: %s", resp.Status, bytes.TrimSpace(body))
}

// reportPartialSuccess surfaces spans the receiver accepted the request for
// but rejected, through the global OpenTelemetry error handler, as the
// official exporter does. The answer may be OTLP/protobuf or OTLP/JSON.
func reportPartialSuccess(contentType string, body []byte) {
	if len(body) == 0 {
		return
	}
	var rejected int64
	var message string
	if mediaType, _, _ := mime.ParseMediaType(contentType); mediaType == ContentType {
		var ok bool
		if rejected, message, ok = decodePartialSuccess(body); !ok {
			return
		}
	} else {
		var answer struct {
			PartialSuccess struct {
				RejectedSpans json.Number `json:"rejectedSpans"`
				ErrorMessage  string      `json:"errorMessage"`
			} `json:"partialSuccess"`
		}
		if json.Unmarshal(body, &answer) != nil {
			return
		}
		rejected, _ = answer.PartialSuccess.RejectedSpans.Int64()
		message = answer.PartialSuccess.ErrorMessage
	}
	if rejected > 0 || message != "" {
		otel.Handle(fmt.Errorf("otlphttp: partial success: %d spans rejected: %s", rejected, message))
	}
}

// decodePartialSuccess reads ExportTraceServiceResponse (1 partial_success)
// and its ExportTracePartialSuccess (1 rejected_spans, 2 error_message).
func decodePartialSuccess(body []byte) (rejected int64, message string, ok bool) {
	inner, err := subFields(body, 1)
	if err != nil {
		return 0, "", false
	}
	for _, g := range inner {
		switch g.number {
		case 1:
			rejected = int64(g.num)
		case 2:
			message = string(g.data)
		}
	}
	return rejected, message, true
}

// subFields reads the fields of every occurrence of message field num in b,
// which protobuf merges into one message.
func subFields(b []byte, num int) ([]field, error) {
	fields, err := readFields(b)
	if err != nil {
		return nil, err
	}
	var out []field
	for _, f := range fields {
		if f.number != num {
			continue
		}
		inner, err := readFields(f.data)
		if err != nil {
			return nil, err
		}
		out = append(out, inner...)
	}
	return out, nil
}

var (
	gzipPool = sync.Pool{New: func() any { return gzip.NewWriter(io.Discard) }}
	bodyPool = sync.Pool{New: func() any { return new([]byte) }}
)

// encode marshals the request and, when compression is on, gzips it from a
// pooled scratch buffer through a pooled writer. The returned body is never
// pooled: the transport may still read a request body after Do returns.
func (e *Exporter) encode(spans []sdktrace.ReadOnlySpan) ([]byte, error) {
	if !e.compression {
		return Marshal(spans), nil
	}

	scratch := bodyPool.Get().(*[]byte)
	defer bodyPool.Put(scratch)
	*scratch = AppendRequest((*scratch)[:0], spans)

	var buf bytes.Buffer
	zw := gzipPool.Get().(*gzip.Writer)
	defer func() {
		zw.Reset(io.Discard) // drop the reference to buf before pooling
		gzipPool.Put(zw)
	}()
	zw.Reset(&buf)
	if _, err := zw.Write(*scratch); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
