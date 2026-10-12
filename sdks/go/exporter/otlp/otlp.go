// Package otlp sends LangWatch spans through the official OpenTelemetry
// otlptracehttp exporter (OTLP/HTTP with protobuf bodies).
//
// The root langwatch package's default exporter speaks OTLP/JSON over the
// standard library so that importing it does not link gRPC and the generated
// OTLP protobuf packages, which otlptracehttp pulls in. Use this package when
// those are already in your binary, or when you depend on otlptracehttp's own
// behavior, such as the OTEL_EXPORTER_OTLP_* environment variables (TLS
// certificates, timeout, compression) or its retry policy.
//
//	exporter, err := otlp.NewExporter(ctx, langwatch.WithFilters(langwatch.ExcludeHTTPRequests()))
//
// or, composed with any other langwatch constructor:
//
//	exporter, err := langwatch.NewDefaultExporter(ctx, otlp.WithTransport())
package otlp

import (
	"context"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
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
// same options, environment fallbacks, filters and data capture, over
// OTLP/protobuf. This is what langwatch.NewExporter did before it switched to
// OTLP/JSON.
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
