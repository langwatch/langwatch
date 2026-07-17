package httpmiddleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// The control plane injects a `traceparent`; if we do not adopt it, the manager's
// spans start a fresh trace and the turn's two halves cannot be stitched into one
// waterfall. That silent orphaning is the bug this middleware exists to fix, so
// it gets the regression test: same trace id as the caller, and the caller's span
// as parent.
func TestTracing_AdoptsInboundTraceparentAsParent(t *testing.T) {
	prevProp := otel.GetTextMapPropagator()
	prevTP := otel.GetTracerProvider()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	otel.SetTracerProvider(sdktrace.NewTracerProvider())
	t.Cleanup(func() {
		otel.SetTextMapPropagator(prevProp)
		otel.SetTracerProvider(prevTP)
	})

	// A well-formed W3C traceparent: version-traceid-spanid-flags (sampled).
	const (
		parentTraceID = "4bf92f3577b34da6a3ce929d0e0e4736"
		parentSpanID  = "00f067aa0ba902b7"
	)
	traceparent := "00-" + parentTraceID + "-" + parentSpanID + "-01"

	var got trace.SpanContext
	handler := Tracing("test")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = trace.SpanContextFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/warm", nil)
	req.Header.Set("traceparent", traceparent)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	require.True(t, got.IsValid(), "handler must run inside a valid span")
	assert.Equal(t, parentTraceID, got.TraceID().String(),
		"server span must join the caller's trace, not start a new one")
	assert.NotEqual(t, parentSpanID, got.SpanID().String(),
		"server span must be its own span, a child — not the caller's span reused")
}

// Without an inbound traceparent the middleware must still work — it just roots a
// new trace. A manager called directly (probes, curl, tests) must not blow up.
func TestTracing_StartsNewTraceWhenNoInboundContext(t *testing.T) {
	prevProp := otel.GetTextMapPropagator()
	prevTP := otel.GetTracerProvider()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	otel.SetTracerProvider(sdktrace.NewTracerProvider())
	t.Cleanup(func() {
		otel.SetTextMapPropagator(prevProp)
		otel.SetTracerProvider(prevTP)
	})

	var got trace.SpanContext
	handler := Tracing("test")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = trace.SpanContextFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/health", nil))

	require.True(t, got.IsValid(), "must still open a span with no inbound context")
	assert.True(t, got.TraceID().IsValid())
}
