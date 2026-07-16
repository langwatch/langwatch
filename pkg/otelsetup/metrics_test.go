package otelsetup

import (
	"context"
	"testing"
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
		// nlpgo: a metric stream has no per-tenant routing analogue, so it opts out
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
