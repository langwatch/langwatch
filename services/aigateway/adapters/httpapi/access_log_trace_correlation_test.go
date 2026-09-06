package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// The gateway's access log has to carry the trace it belongs to, and whether it
// does is decided entirely by the order the two middlewares are registered in.
//
// Telemetry captures its context up front — `ctx := clog.With(r.Context(), ...)`
// — and logs `request_completed` with that same value AFTER the inner chain
// returns. Anything a LATER middleware puts on a derived context is therefore
// invisible to it. Registered after Telemetry, the tracer stamped
// trace_id/span_id onto a context the access log never reads, and in production
// 0 of 10,762 gateway records carried a trace_id while langyagent — same two
// middlewares, wired the other way round — carried one on 98.7%.
//
// Asserting on the emitted record rather than on the order of the `r.Use` calls
// is deliberate: the ordering is the current cause, but the property that
// matters is that the line can be joined to its trace, however that is achieved.
func TestAccessLogCarriesTraceCorrelation(t *testing.T) {
	core, logs := observer.New(zap.InfoLevel)

	// A real SDK provider, so the middleware starts a span with a valid,
	// sampled context — a no-op tracer would make this pass vacuously.
	// The middleware resolves its tracer from the GLOBAL provider, so the
	// global is what has to be real here — with the default no-op the span
	// context is invalid and both tests would pass for the wrong reason.
	provider := trace.NewTracerProvider(trace.WithSampler(trace.AlwaysSample()))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(t.Context())
	})

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := clog.Set(req.Context(), zap.New(core))
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	// The order under test, mirroring NewRouter.
	r.Use(gatewaytracer.Middleware(gatewaytracer.DefaultSpanName))
	r.Use(httpmiddleware.Telemetry())

	r.Get("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	r.ServeHTTP(httptest.NewRecorder(), req)

	completed := logs.FilterMessage("request_completed").All()
	if len(completed) != 1 {
		t.Fatalf("expected one request_completed record, got %d", len(completed))
	}

	fields := completed[0].ContextMap()

	traceID, ok := fields[clog.FieldTraceID].(string)
	if !ok || traceID == "" {
		t.Errorf(
			"access log carries no %s, so it cannot be joined to its trace; fields: %v",
			clog.FieldTraceID, fields,
		)
	}

	spanID, ok := fields[clog.FieldSpanID].(string)
	if !ok || spanID == "" {
		t.Errorf("access log carries no %s; fields: %v", clog.FieldSpanID, fields)
	}
}

// The same property against the router the service actually serves, so the
// registration order in NewRouter is what is guarded rather than a chain
// assembled here to match it.
func TestNewRouterAccessLogCarriesTraceCorrelation(t *testing.T) {
	core, logs := observer.New(zap.InfoLevel)

	provider := trace.NewTracerProvider(trace.WithSampler(trace.AlwaysSample()))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(t.Context())
	})

	reg := health.New("test")
	reg.MarkStarted()
	router := NewRouter(RouterDeps{
		App:    app.New(),
		Logger: zap.NewNop(),
		Health: reg,
	})

	// clog.Set on the way in, so the observer sees whatever the chain derives.
	outer := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		router.ServeHTTP(w, req.WithContext(clog.Set(req.Context(), zap.New(core))))
	})

	outer.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/readyz", nil))

	completed := logs.FilterMessage("request_completed").All()
	if len(completed) == 0 {
		t.Fatal("the real router emitted no request_completed record")
	}

	if id, ok := completed[0].ContextMap()[clog.FieldTraceID].(string); !ok || id == "" {
		t.Errorf(
			"NewRouter's access log carries no %s — check the order of "+
				"gatewaytracer.Middleware and httpmiddleware.Telemetry; fields: %v",
			clog.FieldTraceID, completed[0].ContextMap(),
		)
	}
}

// The inverse, so the test above cannot pass for the wrong reason: with
// Telemetry registered OUTSIDE the tracer — the order that shipped — the ids
// are absent. If this ever starts finding them, Telemetry has been made to read
// the live context and the ordering constraint no longer binds.
func TestAccessLogLosesCorrelationWhenTelemetryWrapsTheTracer(t *testing.T) {
	core, logs := observer.New(zap.InfoLevel)

	// The middleware resolves its tracer from the GLOBAL provider, so the
	// global is what has to be real here — with the default no-op the span
	// context is invalid and both tests would pass for the wrong reason.
	provider := trace.NewTracerProvider(trace.WithSampler(trace.AlwaysSample()))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(t.Context())
	})

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := clog.Set(req.Context(), zap.New(core))
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Use(httpmiddleware.Telemetry())
	r.Use(gatewaytracer.Middleware(gatewaytracer.DefaultSpanName))

	r.Get("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/models", nil))

	completed := logs.FilterMessage("request_completed").All()
	if len(completed) != 1 {
		t.Fatalf("expected one request_completed record, got %d", len(completed))
	}

	if _, present := completed[0].ContextMap()[clog.FieldTraceID]; present {
		t.Errorf(
			"expected no %s in the broken order — if this now passes, the ordering "+
				"constraint the router comment relies on is gone and that comment needs updating",
			clog.FieldTraceID,
		)
	}
}
