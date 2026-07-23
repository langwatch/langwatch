package otelsetup

import (
	"context"
	"strings"

	otelruntime "go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// newMetricReader builds an OTLP/HTTP metric reader (an otlpmetrichttp exporter
// behind a PeriodicReader) for endpointURL — the FULL per-signal URL, already
// carrying /v1/metrics. Callers assemble one or more readers into a single
// MeterProvider (see installMetrics) so the same instruments fan out to every
// configured sink.
func newMetricReader(ctx context.Context, endpointURL string, headers map[string]string) (sdkmetric.Reader, error) {
	exporterOpts := []otlpmetrichttp.Option{
		otlpmetrichttp.WithEndpointURL(endpointURL),
	}
	if len(headers) > 0 {
		exporterOpts = append(exporterOpts, otlpmetrichttp.WithHeaders(headers))
	}
	exp, err := otlpmetrichttp.New(ctx, exporterOpts...)
	if err != nil {
		return nil, err
	}
	return sdkmetric.NewPeriodicReader(exp), nil
}

// metricsEndpointFromTraces derives the /v1/metrics URL from the primary traces
// endpoint. pkg/config/otel.go normalises the primary endpoint to end in
// /v1/traces, so strip that signal path back off and append /v1/metrics; a value
// without the traces suffix is treated as a base URL.
func metricsEndpointFromTraces(tracesEndpoint string) string {
	base := strings.TrimSuffix(tracesEndpoint, "/v1/traces")
	return withSignalPath(base, "/v1/metrics")
}

// startRuntimeMetrics emits Go runtime metrics (GC pauses, goroutine count,
// heap/mem) through the given MeterProvider. Correlating runtime health with
// traces + logs is the baseline every service benefits from; hand-rolled
// business instruments (langy.worker.*, gateway.*) register against the same
// global MeterProvider this installs.
func startRuntimeMetrics(mp *sdkmetric.MeterProvider) error {
	return otelruntime.Start(otelruntime.WithMeterProvider(mp))
}
