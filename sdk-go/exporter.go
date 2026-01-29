package langwatch

import (
	"context"
	"net/url"
	"os"

	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	// DefaultEndpoint is the default LangWatch API endpoint.
	DefaultEndpoint = "https://app.langwatch.ai"
	// TracesPath is the OTLP traces endpoint path.
	TracesPath = "/api/otel/v1/traces"
)

// LangWatchExporter exports spans to LangWatch with optional filtering.
// It wraps an OTLP trace exporter with auto-configuration and filter support.
type LangWatchExporter struct {
	*FilteringExporter
}

// exporterConfig holds configuration for the exporter.
type exporterConfig struct {
	apiKey   string
	endpoint string
	filters  []Filter
}

// ExporterOption configures the LangWatchExporter.
type ExporterOption func(*exporterConfig)

// WithAPIKey sets the LangWatch API key.
// If not set, reads from LANGWATCH_API_KEY environment variable.
func WithAPIKey(key string) ExporterOption {
	return func(c *exporterConfig) {
		c.apiKey = key
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

// WithFilters sets the filters to apply to spans before exporting.
// Multiple filters are applied in sequence (AND semantics).
func WithFilters(filters ...Filter) ExporterOption {
	return func(c *exporterConfig) {
		c.filters = append(c.filters, filters...)
	}
}

// resolveConfig applies options and environment fallbacks.
func resolveConfig(opts ...ExporterOption) *exporterConfig {
	cfg := &exporterConfig{
		apiKey:   os.Getenv("LANGWATCH_API_KEY"),
		endpoint: os.Getenv("LANGWATCH_ENDPOINT"),
	}
	if cfg.endpoint == "" {
		cfg.endpoint = DefaultEndpoint
	}
	for _, opt := range opts {
		opt(cfg)
	}
	return cfg
}

// buildHeaders constructs the LangWatch-specific headers.
func buildHeaders(apiKey string) map[string]string {
	return map[string]string{
		"Authorization":            "Bearer " + apiKey,
		"x-langwatch-sdk-name":     "langwatch-sdk-go",
		"x-langwatch-sdk-language": "go",
		"x-langwatch-sdk-version":  Version,
	}
}

// NewExporter creates a LangWatch exporter with auto-configuration.
// It reads LANGWATCH_API_KEY and LANGWATCH_ENDPOINT from environment variables
// if not provided via options.
func NewExporter(ctx context.Context, opts ...ExporterOption) (*LangWatchExporter, error) {
	cfg := resolveConfig(opts...)

	endpointURL, err := url.JoinPath(cfg.endpoint, TracesPath)
	if err != nil {
		return nil, err
	}

	otlpExporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(endpointURL),
		otlptracehttp.WithHeaders(buildHeaders(cfg.apiKey)),
	)
	if err != nil {
		return nil, err
	}

	return &LangWatchExporter{
		FilteringExporter: NewFilteringExporter(otlpExporter, cfg.filters...),
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
	wrapped sdktrace.SpanExporter
	filters []Filter
}

// NewFilteringExporter creates a filtering wrapper around any SpanExporter.
// This is useful for testing or when you want to add filtering to a custom exporter.
func NewFilteringExporter(wrapped sdktrace.SpanExporter, filters ...Filter) *FilteringExporter {
	return &FilteringExporter{
		wrapped: wrapped,
		filters: filters,
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

	return e.wrapped.ExportSpans(ctx, filtered)
}

// Shutdown shuts down the wrapped exporter.
func (e *FilteringExporter) Shutdown(ctx context.Context) error {
	return e.wrapped.Shutdown(ctx)
}
