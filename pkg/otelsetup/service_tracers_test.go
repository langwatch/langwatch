package otelsetup

import (
	"context"
	"testing"

	otelapi "go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// isolateGlobalTracers gives a test a fresh registry and restores the global.
func isolateGlobalTracers(t *testing.T) {
	t.Helper()
	saved, savedGlobal := globalTracers, otelapi.GetTracerProvider()
	globalTracers = &serviceTracers{providers: map[string]*sdktrace.TracerProvider{}}
	t.Cleanup(func() {
		globalTracers = saved
		otelapi.SetTracerProvider(savedGlobal)
	})
}

func recordingProvider() (*sdktrace.TracerProvider, *tracetest.InMemoryExporter) {
	exporter := tracetest.NewInMemoryExporter()
	return sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)), exporter
}

func serviceContext(service string) context.Context {
	return contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{Service: service})
}

// @scenario "Services sharing one Go process keep their own telemetry identity"
func TestOneServiceOwnsTheGlobalTracerProviderDirectly(t *testing.T) {
	isolateGlobalTracers(t)
	tp, _ := recordingProvider()
	installTracerProvider("langwatch-service-aigateway", tp)
	if otelapi.GetTracerProvider() != tp {
		t.Fatal("a single service's provider is not the global; one-service processes must be unchanged")
	}
}

// @scenario "Services sharing one Go process keep their own telemetry identity"
func TestServicesSharingAProcessKeepTheirOwnTracerProvider(t *testing.T) {
	isolateGlobalTracers(t)
	gatewayTP, gatewaySpans := recordingProvider()
	nlpTP, nlpSpans := recordingProvider()
	installTracerProvider("langwatch-service-aigateway", gatewayTP)
	installTracerProvider("langwatch-service-nlp", nlpTP)

	tracer := otelapi.Tracer("shared-middleware")
	_, span := tracer.Start(serviceContext("langwatch-service-aigateway"), "gateway-request")
	span.End()
	_, span = tracer.Start(serviceContext("langwatch-service-nlp"), "nlp-request")
	span.End()
	_, span = tracer.Start(context.Background(), "unnamed")
	span.End()

	if got := gatewaySpans.GetSpans(); len(got) != 1 || got[0].Name != "gateway-request" {
		t.Errorf("gateway provider recorded %v, want only its own request", got)
	}
	nlp := nlpSpans.GetSpans()
	if len(nlp) != 2 || nlp[0].Name != "nlp-request" || nlp[1].Name != "unnamed" {
		t.Errorf("nlp provider recorded %v, want its request and the unnamed span (latest registered)", nlp)
	}
	if err := globalTracers.ForceFlush(context.Background()); err != nil {
		t.Errorf("flushing both providers: %v", err)
	}
}
