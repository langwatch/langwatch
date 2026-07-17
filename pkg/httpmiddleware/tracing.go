package httpmiddleware

import (
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
	"go.opentelemetry.io/otel/trace"
)

// Tracing extracts inbound W3C trace context and opens a SERVER span for the
// request.
//
// Why this exists, separately from Telemetry(): Telemetry only writes LOGS. It
// never touched the trace context, so a caller that had carefully injected a
// `traceparent` header got it silently dropped on the floor — the callee's spans
// surfaced as a brand-new trace with no parent, and the two halves of a
// distributed request could not be stitched together. For the Langy manager that
// meant the control plane could see its own phases (route, credential mint,
// warm) but the worker spawn, the opencode turn and each CLI invocation landed
// in an unrelated trace, so the one question the trace exists to answer — does
// the /warm boot actually overlap the rest of the request, or is it still on the
// critical path? — was unanswerable.
//
// Extraction uses the GLOBAL propagator, which otelsetup.New installs as a
// composite including propagation.TraceContext. If a service never calls
// otelsetup (tests, tools), the global propagator is a no-op and Extract quietly
// returns the context unchanged — so this middleware is safe to mount
// unconditionally.
//
// Mount it OUTSIDE Telemetry() so the request logger's context already carries
// the span, letting logs and spans be correlated by trace id.
//
// This is the same inbound-extraction move nlpgo already makes in
// adapters/httpapi/causality.go; that one additionally tracks a causality depth
// which only nlpgo needs, so the shared piece lives here rather than being
// lifted wholesale.
func Tracing(instrumentationName string) func(http.Handler) http.Handler {
	tracer := otel.Tracer(instrumentationName)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := otel.GetTextMapPropagator().Extract(
				r.Context(),
				propagation.HeaderCarrier(r.Header),
			)

			// Route pattern, not the raw path: r.URL.Path would put ids and other
			// high-cardinality junk into span names. ServeMux exposes the matched
			// pattern, and the manager's routes are static anyway.
			name := r.Method + " " + r.URL.Path

			ctx, span := tracer.Start(ctx, name,
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(
					semconv.HTTPRequestMethodKey.String(r.Method),
					semconv.URLPath(r.URL.Path),
				),
			)
			defer span.End()

			rec := &responseRecorder{ResponseWriter: w, status: 200}
			next.ServeHTTP(rec, r.WithContext(ctx))

			span.SetAttributes(semconv.HTTPResponseStatusCode(rec.status))
			// Only 5xx marks the span errored: a 4xx is the caller's problem and a
			// trace full of red spans for routine 401s/409s is noise that trains
			// people to ignore the color.
			if rec.status >= 500 {
				span.SetStatus(codes.Error, http.StatusText(rec.status))
			}
			if rec.err != nil {
				span.RecordError(rec.err)
			}
		})
	}
}
