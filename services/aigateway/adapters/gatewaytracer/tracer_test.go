package gatewaytracer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/pkg/clog"
)

func TestMiddlewareKeepsInternalRootAndLinksInboundTrace(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))

	previousProvider := otelapi.GetTracerProvider()
	previousPropagator := otelapi.GetTextMapPropagator()
	otelapi.SetTracerProvider(provider)
	otelapi.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otelapi.SetTracerProvider(previousProvider)
		otelapi.SetTextMapPropagator(previousPropagator)
		_ = provider.Shutdown(context.Background())
	})

	const (
		observedTraceID = "0123456789abcdef0123456789abcdef"
		observedSpanID  = "0011223344556677"
	)

	handler := Middleware(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("traceparent", "00-"+observedTraceID+"-"+observedSpanID+"-01")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("exported spans = %d, want 1", len(spans))
	}
	span := spans[0]
	if span.SpanContext.TraceID().String() == observedTraceID {
		t.Fatal("gateway ops span inherited the untrusted inbound trace instead of starting a new root")
	}
	if span.Parent.IsValid() {
		t.Fatalf("gateway ops span has parent %s, want a root span", span.Parent.SpanID())
	}
	if len(span.Links) != 1 {
		t.Fatalf("span links = %d, want 1", len(span.Links))
	}
	if got := span.Links[0].SpanContext.TraceID().String(); got != observedTraceID {
		t.Fatalf("linked trace ID = %s, want %s", got, observedTraceID)
	}
	if got := span.Links[0].SpanContext.SpanID().String(); got != observedSpanID {
		t.Fatalf("linked span ID = %s, want %s", got, observedSpanID)
	}

	attributes := make(map[string]string, len(span.Attributes))
	for _, attr := range span.Attributes {
		attributes[string(attr.Key)] = attr.Value.AsString()
	}
	if got := attributes[clog.FieldObservedTraceID]; got != observedTraceID {
		t.Fatalf("%s = %q, want %q", clog.FieldObservedTraceID, got, observedTraceID)
	}
	if got := attributes[clog.FieldObservedSpanID]; got != observedSpanID {
		t.Fatalf("%s = %q, want %q", clog.FieldObservedSpanID, got, observedSpanID)
	}
}
