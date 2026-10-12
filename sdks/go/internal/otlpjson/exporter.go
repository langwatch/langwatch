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
	"sync"
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
	// Retry controls retries of throttled (429) and failed (5xx) exports.
	Retry RetryConfig
}

// Exporter is an sdktrace.SpanExporter that posts OTLP/JSON over HTTP. It is
// safe for concurrent use; batching is left to sdktrace.BatchSpanProcessor.
type Exporter struct {
	url         string
	headers     map[string]string
	client      *http.Client
	compression bool
	retry       RetryConfig

	mu       sync.RWMutex
	shutdown bool
}

var _ sdktrace.SpanExporter = (*Exporter)(nil)

// New returns an Exporter for cfg. Zero retry fields take the defaults
// documented on RetryConfig.
func New(cfg Config) *Exporter {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: DefaultTimeout}
	}
	headers := make(map[string]string, len(cfg.Headers))
	for k, v := range cfg.Headers {
		headers[k] = v
	}
	return &Exporter{
		url:         cfg.URL,
		headers:     headers,
		client:      client,
		compression: !cfg.DisableCompression,
		retry:       cfg.Retry.withDefaults(),
	}
}

// ExportSpans encodes spans and posts them, retrying throttled and failed
// attempts with backoff until the retry budget or ctx runs out.
func (e *Exporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	e.mu.RLock()
	closed := e.shutdown
	e.mu.RUnlock()
	if closed {
		return ErrShutdown
	}
	if len(spans) == 0 {
		return nil
	}

	payload, err := Marshal(spans)
	if err != nil {
		return fmt.Errorf("otlpjson: encoding spans: %w", err)
	}
	encoding := ""
	if e.compression {
		if payload, err = gzipBytes(payload); err != nil {
			return fmt.Errorf("otlpjson: compressing spans: %w", err)
		}
		encoding = "gzip"
	}

	return e.retry.do(ctx, func(ctx context.Context) error {
		return e.send(ctx, payload, encoding)
	})
}

// Shutdown stops further exports. In-flight exports finish on their own
// context. It is idempotent.
func (e *Exporter) Shutdown(ctx context.Context) error {
	e.mu.Lock()
	e.shutdown = true
	e.mu.Unlock()
	e.client.CloseIdleConnections()
	return ctx.Err()
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
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// Connection-level failures (refused, reset, timeout) are transient.
		return &retryableError{err: err}
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
// resending: throttling and server-side failures, but not 501, which will not
// change on retry.
func isRetryableStatus(code int) bool {
	return code == http.StatusTooManyRequests ||
		(code >= 500 && code != http.StatusNotImplemented)
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

func gzipBytes(raw []byte) ([]byte, error) {
	var buf bytes.Buffer
	buf.Grow(len(raw) / 4)
	zw := gzipPool.Get().(*gzip.Writer)
	defer gzipPool.Put(zw)
	zw.Reset(&buf)
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
