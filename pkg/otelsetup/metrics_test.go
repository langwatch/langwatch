package otelsetup

import (
	"context"
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// metricsEndpointFromTraces strips the normalised /v1/traces suffix the primary
// endpoint carries and points metrics at /v1/metrics on the same collector.
func TestMetricsEndpointFromTraces(t *testing.T) {
	cases := map[string]string{
		"https://collector.example/v1/traces": "https://collector.example/v1/metrics",
		"https://collector.example":           "https://collector.example/v1/metrics",
		"https://collector.example/":          "https://collector.example/v1/metrics",
	}
	for in, want := range cases {
		if got := metricsEndpointFromTraces(in); got != want {
			t.Errorf("metricsEndpointFromTraces(%q) = %q, want %q", in, got, want)
		}
	}
}

// The endpoints parse but never connect (otlpmetrichttp.New is lazy), so these
// assert the WIRING: which configurations install a real MeterProvider.
func TestInstallMetrics_MeterProviderWiring(t *testing.T) {
	ctx := context.Background()

	t.Run("when single-tenant with a primary endpoint", func(t *testing.T) {
		// The wiring under test: the primary path now lights up metrics (before, it
		// installed only a TracerProvider, leaving instruments dark in prod).
		p, err := New(ctx, Options{OTLPEndpoint: "http://localhost:1/v1/traces"})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		t.Cleanup(func() { _ = p.Shutdown(ctx) })
		if p.mp == nil {
			t.Fatal("expected a MeterProvider on the single-tenant primary path, got none")
		}
	})

	t.Run("when multi-tenant with no debug collector", func(t *testing.T) {
		// nlpgo: a metric stream has no per-tenant routing analog, so it opts out
		// of the primary reader and the MeterProvider stays the SDK no-op.
		p, err := New(ctx, Options{OTLPEndpoint: "http://localhost:1/v1/traces", MultiTenant: true})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		t.Cleanup(func() { _ = p.Shutdown(ctx) })
		if p.mp != nil {
			t.Fatal("expected NO MeterProvider for a multi-tenant service without a debug collector")
		}
	})

	t.Run("when only the debug collector is set", func(t *testing.T) {
		p, err := New(ctx, Options{DebugCollectorEndpoint: "http://localhost:1"})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		t.Cleanup(func() { _ = p.Shutdown(ctx) })
		if p.mp == nil {
			t.Fatal("expected a MeterProvider when the debug collector is configured")
		}
	})

	t.Run("when nothing is configured", func(t *testing.T) {
		p, err := New(ctx, Options{})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		t.Cleanup(func() { _ = p.Shutdown(ctx) })
		if p.mp != nil {
			t.Fatal("expected NO MeterProvider on the noop path")
		}
	})
}

// TestInstallMetrics_DisabledInstallsNoReader pins the explicit off switch: a
// stack whose observability container is not running says so, and no lane
// exports metrics to an endpoint it inherited from a shell.
//
/** @scenario "A stack without the observability container exports no metrics" */
func TestInstallMetrics_DisabledInstallsNoReader(t *testing.T) {
	ctx := context.Background()

	p, err := New(ctx, Options{
		OTLPEndpoint:           "http://localhost:1/v1/traces",
		DebugCollectorEndpoint: "http://localhost:1",
		MetricsDisabled:        true,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = p.Shutdown(ctx) })
	if p.mp != nil {
		t.Fatal("expected no MeterProvider when metrics are disabled by name")
	}
}

type fixedProducer struct{ name string }

func (p fixedProducer) Produce(context.Context) ([]metricdata.ScopeMetrics, error) {
	return []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{Name: p.name}}}}, nil
}

// A supplied producer reaches the reader, and a nil one is skipped rather than
// panicking on the first export.
// @scenario "a missing producer does not break the metric reader"
func TestNewMetricReader_PullsProducersAndSkipsNil(t *testing.T) {
	ctx := context.Background()
	reader, err := newMetricReader(ctx, metricSink{
		endpointURL: "http://localhost:1/v1/metrics",
		producers:   []sdkmetric.Producer{nil, fixedProducer{name: "gateway_probe"}},
	})
	if err != nil {
		t.Fatalf("newMetricReader: %v", err)
	}
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { _ = mp.Shutdown(ctx) })

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(ctx, &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name == "gateway_probe" {
				return
			}
		}
	}
	t.Fatal("producer metrics did not reach the reader")
}
