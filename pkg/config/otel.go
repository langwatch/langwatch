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
}

// Configure initializes the OTel provider from the config, parsing headers and
// returning a Provider whose Shutdown method flushes pending telemetry.
func (o *OTel) Configure(ctx context.Context, nodeID string) (*otelsetup.Provider, error) {
	return otelsetup.New(ctx, otelsetup.Options{
		NodeID:       nodeID,
		OTLPEndpoint: o.OTLPEndpoint,
		OTLPHeaders:  parseHeaders(o.OTLPHeaders),
		SampleRatio:  o.SampleRatio,
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
