package otelsetup

import (
	"context"

	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// newDebugSpanProcessor builds the additive BatchSpanProcessor that
// dual-exports every span to a developer's local OTLP collector. It is a
// plain (tenant-agnostic) batcher: the collector is trusted local infra,
// so no per-tenant auth routing applies — the point is to see all spans
// the service produces, including ones the tenant router would drop for
// lack of an api_key. The primary product/ops pipeline is untouched.
func newDebugSpanProcessor(ctx context.Context, endpoint string, headers map[string]string) (sdktrace.SpanProcessor, error) {
	exporterOpts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(withSignalPath(endpoint, "/v1/traces")),
	}
	if len(headers) > 0 {
		exporterOpts = append(exporterOpts, otlptracehttp.WithHeaders(headers))
	}
	exp, err := otlptracehttp.New(ctx, exporterOpts...)
	if err != nil {
		return nil, err
	}
	return sdktrace.NewBatchSpanProcessor(exp), nil
}
