package config

import (
	"context"
	"strings"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// OTel holds OpenTelemetry exporter configuration.
type OTel struct {
	OTLPEndpoint string  `env:"OTLP_ENDPOINT"`
	OTLPHeaders  string  `env:"OTLP_HEADERS"`
	SampleRatio  float64 `env:"SAMPLE_RATIO"`
	// SampleRatioSet distinguishes an explicit 0 from an omitted environment
	// variable. It is set by service LoadConfig after Hydrate, because the
	// generic env hydrator intentionally skips empty values.
	SampleRatioSet bool

	// DebugCollectorEndpoint is an OPTIONAL second OTLP/HTTP endpoint —
	// typically a developer's local observability stack (OTel Collector
	// + Loki/Tempo/Prometheus/Grafana) on http://localhost:4318. When
	// set, the service ADDITIONALLY ships its own operational telemetry
	// there: a second span exporter (traces are dual-exported, never
	// diverted from the primary product pipeline), plus net-new OTLP
	// logs and OTLP metrics. This is the base URL only — the per-signal
	// paths (/v1/traces, /v1/logs, /v1/metrics) are appended by
	// otelsetup. Empty (the default everywhere, prod included) means
	// none of the debug-collector behavior is installed.
	DebugCollectorEndpoint string `env:"DEBUG_COLLECTOR_ENDPOINT"`
	// DebugCollectorHeaders carries optional auth headers for the debug
	// collector, in the OTEL_EXPORTER_OTLP_HEADERS "k=v,k2=v2" format.
	DebugCollectorHeaders string `env:"DEBUG_COLLECTOR_HEADERS"`
}

// UnsetSampleRatio is retained for default configuration literals. Use
// SampleRatioSet to distinguish it from an explicit 0 read from the
// OTEL_SAMPLE_RATIO environment variable.
const UnsetSampleRatio = 0

// DefaultNonLocalSampleRatio is the trace sample ratio applied outside local
// development when the operator did not choose one.
const DefaultNonLocalSampleRatio = 0.1

// ResolveSampleRatio fills in the environment-aware default when no ratio was
// configured, and otherwise honors exactly what was asked for. Call once,
// before Validate.
func (o *OTel) ResolveSampleRatio(environment string) {
	if o.SampleRatioSet || o.SampleRatio != UnsetSampleRatio {
		return
	}
	if environment == "local" {
		o.SampleRatio = 1.0
		return
	}
	o.SampleRatio = DefaultNonLocalSampleRatio
}

// DebugCollector returns the debug-collector base endpoint (no signal
// path) and its parsed headers. An empty endpoint means the debug
// collector is disabled. Exposed for services (e.g. nlpgo) that build
// otelsetup.Options directly instead of going through Configure.
func (o *OTel) DebugCollector() (endpoint string, headers map[string]string) {
	return o.DebugCollectorEndpoint, parseHeaders(o.DebugCollectorHeaders)
}

// PrimaryOTLP returns the primary collector's base endpoint (no signal path)
// and its parsed headers. Exposed for callers that forward OTLP payloads
// directly rather than through the SDK exporter — e.g. the Langy relay shipping
// LangWatch's own copy of worker telemetry.
func (o *OTel) PrimaryOTLP() (endpoint string, headers map[string]string) {
	return o.OTLPEndpoint, parseHeaders(o.OTLPHeaders)
}

// Configure initializes the OTel provider from the config, parsing headers and
// returning a Provider whose Shutdown method flushes pending telemetry.
func (o *OTel) Configure(ctx context.Context, nodeID string) (*otelsetup.Provider, error) {
	endpoint := o.OTLPEndpoint
	if endpoint != "" && !strings.HasSuffix(endpoint, "/v1/traces") {
		endpoint = strings.TrimRight(endpoint, "/") + "/v1/traces"
	}
	debugEndpoint, debugHeaders := o.DebugCollector()
	return otelsetup.New(ctx, otelsetup.Options{
		NodeID:                 nodeID,
		OTLPEndpoint:           endpoint,
		OTLPHeaders:            parseHeaders(o.OTLPHeaders),
		SampleRatio:            o.SampleRatio,
		DebugCollectorEndpoint: debugEndpoint,
		DebugCollectorHeaders:  debugHeaders,
	})
}

// parseHeaders parses an OTLP headers string ("key=value,key2=value2") into a map.
// Follows the W3C Baggage / OTEL_EXPORTER_OTLP_HEADERS format.
func parseHeaders(raw string) map[string]string {
	if raw == "" {
		return nil
	}
	headers := make(map[string]string)
	for _, pair := range strings.Split(raw, ",") {
		k, v, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		headers[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}
