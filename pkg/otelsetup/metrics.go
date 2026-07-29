package otelsetup

import (
	"context"

	otelruntime "go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
)

// newMeterProvider builds the OTLP metric pipeline for the debug
// collector: an otlpmetrichttp exporter behind a PeriodicReader, tagged
// with the same resource as the trace and log pipelines. The caller
// registers it as the global MeterProvider and owns its lifecycle via
// Provider.Shutdown.
func newMeterProvider(ctx context.Context, endpoint string, headers map[string]string, res *resource.Resource) (*sdkmetric.MeterProvider, error) {
	exporterOpts := []otlpmetrichttp.Option{
		otlpmetrichttp.WithEndpointURL(withSignalPath(endpoint, "/v1/metrics")),
	}
	if len(headers) > 0 {
		exporterOpts = append(exporterOpts, otlpmetrichttp.WithHeaders(headers))
	}
	exp, err := otlpmetrichttp.New(ctx, exporterOpts...)
	if err != nil {
		return nil, err
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exp)),
	)
	return mp, nil
}

// startRuntimeMetrics emits Go runtime metrics (GC pauses, goroutine
// count, heap/mem) through the given MeterProvider. This is the first
// cut — no hand-rolled business metrics — because runtime health is what
// a local debugging stack needs to correlate with traces and logs.
func startRuntimeMetrics(mp *sdkmetric.MeterProvider) error {
	return otelruntime.Start(otelruntime.WithMeterProvider(mp))
}
