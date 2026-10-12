package langwatch

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"

	"github.com/langwatch/langwatch/sdks/go/internal/otlpjson"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	// DefaultEndpoint is the default LangWatch API endpoint.
	DefaultEndpoint = "https://app.langwatch.ai"
	// TracesPath is the OTLP traces endpoint path.
	TracesPath = "/api/otel/v1/traces"
)

// ErrNilTransportExporter is returned by NewExporter when a custom
// ExporterTransport returns neither an exporter nor an error.
var ErrNilTransportExporter = errors.New("langwatch: ExporterTransport returned a nil exporter")

// LangWatchExporter exports spans to LangWatch with optional filtering.
// It wraps an OTLP/HTTP trace exporter with auto-configuration and filter
// support. By default spans are sent as gzipped OTLP/JSON by an exporter
// built on the standard library, so the root package links neither gRPC nor
// the generated OTLP protobuf packages; see WithTransport to swap it.
type LangWatchExporter struct {
	*FilteringExporter
}

// exporterConfig holds configuration for the exporter.
type exporterConfig struct {
	apiKey      string
	projectID   string
	endpoint    string
	filters     []Filter
	dataCapture dataCaptureConfig

	httpClient         *http.Client
	disableCompression bool
	transport          ExporterTransport
}

// ExporterTransport builds the span exporter that carries spans to LangWatch,
// given the resolved traces URL (endpoint + TracesPath) and the auth and SDK
// headers every request must send. The LangWatch exporter wraps whatever it
// returns with its filters and data-capture policy.
//
// The default transport posts gzipped OTLP/JSON. The
// github.com/langwatch/langwatch/sdks/go/exporter/otlp package provides one
// built on the official otlptracehttp exporter (OTLP/protobuf), for programs
// that already link gRPC or rely on the OTEL_EXPORTER_OTLP_* variables.
type ExporterTransport func(ctx context.Context, endpointURL string, headers map[string]string) (sdktrace.SpanExporter, error)

// ExporterOption configures the LangWatchExporter.
type ExporterOption func(*exporterConfig)

// WithAPIKey sets the LangWatch API key or Personal Access Token.
// If not set, reads from LANGWATCH_API_KEY environment variable.
func WithAPIKey(key string) ExporterOption {
	return func(c *exporterConfig) {
		c.apiKey = key
	}
}

// WithProjectID sets the LangWatch project identifier.
//
// Required when the API key is a Personal Access Token (pat-lw-*); ignored
// for legacy sk-lw-* keys. If not set, reads from the
// LANGWATCH_PROJECT_ID environment variable.
func WithProjectID(projectID string) ExporterOption {
	return func(c *exporterConfig) {
		c.projectID = projectID
	}
}

// WithEndpoint sets the LangWatch endpoint URL.
// If not set, reads from LANGWATCH_ENDPOINT environment variable,
// or falls back to DefaultEndpoint.
func WithEndpoint(url string) ExporterOption {
	return func(c *exporterConfig) {
		c.endpoint = url
	}
}

// WithDataCapture sets a fixed data-capture mode controlling whether span
// input/output content is exported (DataCaptureAll/Input/Output/None). Span
// structure, metrics, metadata and models are always kept. Applies to every
// span this exporter handles, across all instrumentations.
func WithDataCapture(mode DataCaptureMode) ExporterOption {
	return func(c *exporterConfig) {
		c.dataCapture = dataCaptureConfig{enabled: true, mode: mode}
	}
}

// WithDataCaptureFunc sets a per-span data-capture predicate. The predicate
// receives the span's name, kind, LangWatch span type and attributes and returns
// the mode to apply — enabling policies like "capture nothing for tool spans".
func WithDataCaptureFunc(predicate DataCapturePredicate) ExporterOption {
	return func(c *exporterConfig) {
		c.dataCapture = dataCaptureConfig{enabled: true, predicate: predicate}
	}
}

// WithFilters sets the filters to apply to spans before exporting.
// Multiple filters are applied in sequence (AND semantics).
func WithFilters(filters ...Filter) ExporterOption {
	return func(c *exporterConfig) {
		c.filters = append(c.filters, filters...)
	}
}

// WithTransport replaces the transport that sends spans to LangWatch. With a
// custom transport, WithHTTPClient and WithCompression have no effect.
func WithTransport(transport ExporterTransport) ExporterOption {
	return func(c *exporterConfig) {
		c.transport = transport
	}
}

// WithHTTPClient sets the HTTP client the default transport sends with, e.g.
// to set a proxy, TLS configuration or a per-request timeout. If not set, a
// client with a 10 second timeout is used.
func WithHTTPClient(client *http.Client) ExporterOption {
	return func(c *exporterConfig) {
		c.httpClient = client
	}
}

// WithCompression turns gzip compression of the default transport's request
// bodies on or off. It is on by default.
func WithCompression(enabled bool) ExporterOption {
	return func(c *exporterConfig) {
		c.disableCompression = !enabled
	}
}

// resolveConfig applies options and environment fallbacks.
func resolveConfig(opts ...ExporterOption) *exporterConfig {
	cfg := &exporterConfig{
		apiKey:    os.Getenv("LANGWATCH_API_KEY"),
		projectID: os.Getenv("LANGWATCH_PROJECT_ID"),
		endpoint:  os.Getenv("LANGWATCH_ENDPOINT"),
	}
	if cfg.endpoint == "" {
		cfg.endpoint = DefaultEndpoint
	}
	for _, opt := range opts {
		opt(cfg)
	}
	return cfg
}

// buildHeaders constructs the LangWatch-specific headers, delegating
// auth-header assembly to buildAuthHeaders (Authorization: Bearer plus an
// X-Project-Id header when a project ID is available).
func buildHeaders(apiKey, projectID string) map[string]string {
	headers := buildAuthHeaders(apiKey, projectID)
	headers["x-langwatch-sdk-name"] = "langwatch-sdk-go"
	headers["x-langwatch-sdk-language"] = "go"
	headers["x-langwatch-sdk-version"] = Version
	return headers
}

// NewExporter creates a LangWatch exporter with auto-configuration.
// It reads LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID and LANGWATCH_ENDPOINT from
// environment variables if not provided via options.
//
// Spans are sent as gzipped OTLP/JSON to endpoint + TracesPath, retrying
// throttled (429) and unavailable (502/503/504) requests with exponential
// backoff for up to a minute, bounded by the export context. Wrap the
// exporter in sdktrace.NewBatchSpanProcessor to batch spans.
func NewExporter(ctx context.Context, opts ...ExporterOption) (*LangWatchExporter, error) {
	cfg := resolveConfig(opts...)

	endpointURL, err := url.JoinPath(cfg.endpoint, TracesPath)
	if err != nil {
		return nil, err
	}
	headers := buildHeaders(cfg.apiKey, cfg.projectID)

	var transport sdktrace.SpanExporter
	if cfg.transport != nil {
		if transport, err = cfg.transport(ctx, endpointURL, headers); err != nil {
			return nil, err
		}
		if transport == nil {
			return nil, ErrNilTransportExporter
		}
	} else {
		transport = otlpjson.New(otlpjson.Config{
			URL:                endpointURL,
			Headers:            headers,
			HTTPClient:         cfg.httpClient,
			DisableCompression: cfg.disableCompression,
		})
	}

	return &LangWatchExporter{
		FilteringExporter: newFilteringExporter(transport, cfg.dataCapture, cfg.filters...),
	}, nil
}

// NewDefaultExporter creates a LangWatch exporter with the ExcludeHTTPRequests preset.
// This is a convenience constructor that excludes common HTTP instrumentation spans.
func NewDefaultExporter(ctx context.Context, opts ...ExporterOption) (*LangWatchExporter, error) {
	// Prepend the default filter before user-provided options
	defaultOpts := []ExporterOption{WithFilters(ExcludeHTTPRequests())}
	allOpts := append(defaultOpts, opts...)
	return NewExporter(ctx, allOpts...)
}

// FilteringExporter wraps any SpanExporter with filtering capabilities.
// This is useful for testing or when using custom exporters.
type FilteringExporter struct {
	wrapped     sdktrace.SpanExporter
	filters     []Filter
	dataCapture dataCaptureConfig
}

// NewFilteringExporter creates a filtering wrapper around any SpanExporter.
// This is useful for testing or when you want to add filtering to a custom exporter.
//
// It applies no data-capture policy: content reaches the wrapped exporter as
// recorded. Use NewExporter with WithDataCapture / WithDataCaptureFunc for a
// capture-gated exporter.
func NewFilteringExporter(wrapped sdktrace.SpanExporter, filters ...Filter) *FilteringExporter {
	return newFilteringExporter(wrapped, dataCaptureConfig{}, filters...)
}

// newFilteringExporter builds the wrapper with a resolved capture policy, so no
// construction path depends on assigning dataCapture after the fact.
func newFilteringExporter(
	wrapped sdktrace.SpanExporter,
	capture dataCaptureConfig,
	filters ...Filter,
) *FilteringExporter {
	return &FilteringExporter{
		wrapped:     wrapped,
		filters:     filters,
		dataCapture: capture,
	}
}

// ExportSpans exports spans after applying filters.
func (e *FilteringExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	if len(spans) == 0 {
		return nil
	}

	// Apply filters
	filtered := applyFilters(spans, e.filters)
	if len(filtered) == 0 {
		return nil
	}

	// Apply data capture: strip input/output content per the resolved mode.
	if e.dataCapture.enabled {
		out := make([]sdktrace.ReadOnlySpan, len(filtered))
		for i, span := range filtered {
			out[i] = applyDataCapture(span, e.dataCapture.resolve(span))
		}
		filtered = out
	}

	return e.wrapped.ExportSpans(ctx, filtered)
}

// Shutdown shuts down the wrapped exporter.
func (e *FilteringExporter) Shutdown(ctx context.Context) error {
	return e.wrapped.Shutdown(ctx)
}
