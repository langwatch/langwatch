package scenariorunner

import (
	"context"
	"net/url"
	"strings"
	"time"

	scenario "github.com/langwatch/scenario/go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// serviceName is the service.name the runner's spans carry unless
// OTEL_SERVICE_NAME names one.
const serviceName = "langwatch-scenario-runner"

// flushTimeout bounds the final export before the process exits.
const flushTimeout = 10 * time.Second

// Telemetry is the run's tracer provider: the resource the parent stated in
// OTEL_RESOURCE_ATTRIBUTES (langwatch.origin.source=platform and the
// scenario's labels), exporting to LANGWATCH_ENDPOINT with the run's key.
type Telemetry struct {
	provider *sdktrace.TracerProvider
}

// TelemetryInput configures SetupTelemetry.
type TelemetryInput struct {
	ResourceAttributes string
	ServiceName        string
	Endpoint           string
	APIKey             string
}

// SetupTelemetry installs the global tracer provider, then lets the scenario
// SDK attach its LangWatch exporter to it.
func SetupTelemetry(ctx context.Context, in TelemetryInput) (*Telemetry, error) {
	name := in.ServiceName
	if name == "" {
		name = serviceName
	}
	attrs := append([]attribute.KeyValue{attribute.String("service.name", name)}, ParseResourceAttributes(in.ResourceAttributes)...)
	res, err := resource.New(ctx, resource.WithTelemetrySDK(), resource.WithAttributes(attrs...))
	if err != nil {
		return nil, err
	}
	provider := sdktrace.NewTracerProvider(sdktrace.WithResource(res))
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	err = scenario.SetupScenarioTracing(scenario.TracingOptions{
		LangWatch: scenario.LangWatchConfig{Endpoint: in.Endpoint, APIKey: in.APIKey},
	})
	return &Telemetry{provider: provider}, err
}

// Flush exports every pending span; a failure is reported, never fatal, as
// the run's result is already decided. The provider is not shut down: the
// SDK's span collector panics on Shutdown, and the process exits next anyway.
func (t *Telemetry) Flush(ctx context.Context) error {
	if t == nil || t.provider == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), flushTimeout)
	defer cancel()
	return t.provider.ForceFlush(ctx)
}

// ParseResourceAttributes reads OTEL_RESOURCE_ATTRIBUTES as the parent writes
// it: key=value pairs split on unescaped commas, `\,` `\=` `\\` unescaped,
// then percent-decoded. The parent joins a scenario's labels with plain
// commas, so a segment with no `=` continues the previous value: two labels
// report scenario.labels="a,b" rather than losing the attribute.
func ParseResourceAttributes(raw string) []attribute.KeyValue {
	var keys, values []string
	for _, segment := range splitUnescaped(raw, ',') {
		parts := splitUnescaped(segment, '=')
		if len(parts) < 2 {
			if len(values) > 0 && strings.TrimSpace(segment) != "" {
				values[len(values)-1] += "," + decodeAttribute(segment)
			}
			continue
		}
		keys = append(keys, strings.TrimSpace(decodeAttribute(parts[0])))
		values = append(values, decodeAttribute(strings.Join(parts[1:], "=")))
	}
	var out []attribute.KeyValue
	for i, k := range keys {
		if k != "" {
			out = append(out, attribute.String(k, strings.TrimSpace(values[i])))
		}
	}
	return out
}

// splitUnescaped splits on sep where no backslash escapes it, keeping escapes.
func splitUnescaped(s string, sep byte) []string {
	var parts []string
	start := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\':
			i++
		case sep:
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	return append(parts, s[start:])
}

func decodeAttribute(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			i++
		}
		b.WriteByte(s[i])
	}
	if decoded, err := url.PathUnescape(b.String()); err == nil {
		return decoded
	}
	return b.String()
}
