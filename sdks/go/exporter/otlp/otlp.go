// Package otlp sends LangWatch spans through the official otlptracehttp
// exporter, for programs that already link gRPC or rely on its
// OTEL_EXPORTER_OTLP_* variables or retry policy. It is its own module so
// the root SDK does not depend on gRPC. Use NewExporter, or WithTransport on
// any langwatch constructor; the SDK README has examples.
package otlp

import (
	"context"

	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

// Transport returns a langwatch.ExporterTransport that builds an
// otlptracehttp exporter for the LangWatch traces URL and headers. extra
// options are applied after the URL and headers, so they can override them.
func Transport(extra ...otlptracehttp.Option) langwatch.ExporterTransport {
	return func(ctx context.Context, endpointURL string, headers map[string]string) (sdktrace.SpanExporter, error) {
		opts := make([]otlptracehttp.Option, 0, 2+len(extra))
		opts = append(opts,
			otlptracehttp.WithEndpointURL(endpointURL),
			otlptracehttp.WithHeaders(headers),
		)
		opts = append(opts, extra...)
		return otlptracehttp.New(ctx, opts...)
	}
}

// WithTransport is the langwatch.ExporterOption that sends through
// otlptracehttp, with optional extra otlptracehttp options.
func WithTransport(extra ...otlptracehttp.Option) langwatch.ExporterOption {
	return langwatch.WithTransport(Transport(extra...))
}

// NewExporter is langwatch.NewExporter sending through otlptracehttp: the
// same options, environment fallbacks, filters and data capture.
func NewExporter(ctx context.Context, opts ...langwatch.ExporterOption) (*langwatch.LangWatchExporter, error) {
	return langwatch.NewExporter(ctx, withTransportLast(opts)...)
}

// NewDefaultExporter is langwatch.NewDefaultExporter (the ExcludeHTTPRequests
// preset) sending through otlptracehttp.
func NewDefaultExporter(ctx context.Context, opts ...langwatch.ExporterOption) (*langwatch.LangWatchExporter, error) {
	return langwatch.NewDefaultExporter(ctx, withTransportLast(opts)...)
}

// withTransportLast copies opts with WithTransport appended, so it wins over
// any transport in opts without writing into the caller's slice.
func withTransportLast(opts []langwatch.ExporterOption) []langwatch.ExporterOption {
	out := make([]langwatch.ExporterOption, 0, len(opts)+1)
	out = append(out, opts...)
	return append(out, WithTransport())
}
