package otelsetup

import (
	"context"

	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
)

// newLoggerProvider builds the OTLP log pipeline for the debug collector:
// an otlploghttp exporter behind a BatchProcessor, tagged with the same
// resource (service.name / version / environment / node.id) as the trace
// and metric pipelines. The returned provider is NOT set as an OTel
// global — clog tees it into the zap core explicitly so stdout logging is
// preserved. Its lifecycle is owned by Provider.Shutdown.
func newLoggerProvider(ctx context.Context, endpoint string, headers map[string]string, res *resource.Resource) (*sdklog.LoggerProvider, error) {
	exporterOpts := []otlploghttp.Option{
		otlploghttp.WithEndpointURL(withSignalPath(endpoint, "/v1/logs")),
	}
	if len(headers) > 0 {
		exporterOpts = append(exporterOpts, otlploghttp.WithHeaders(headers))
	}
	exp, err := otlploghttp.New(ctx, exporterOpts...)
	if err != nil {
		return nil, err
	}
	lp := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exp)),
	)
	return lp, nil
}
