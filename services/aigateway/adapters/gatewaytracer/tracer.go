package gatewaytracer

import (
	"net/http"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/clog"
)

// Middleware creates a chi middleware that wraps each request in a gateway span.
// It uses the globally-registered TracerProvider (set by pkg/otelsetup).
func Middleware(spanNamer func(*http.Request) string) func(http.Handler) http.Handler {
	tracer := otelapi.Tracer("langwatch-ai-gateway")

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name := "lw_gateway.request"
			if spanNamer != nil {
				if n := spanNamer(r); n != "" {
					name = n
				}
			}

			// Always start a fresh root — never inherit client traceparent.
			// The customer's inbound trace (if they propagated one) is
			// OBSERVED — kept distinct from our own new-root ops trace below.
			observedSC := trace.SpanContextFromContext(
				otelapi.GetTextMapPropagator().Extract(
					r.Context(), propagation.HeaderCarrier(r.Header),
				),
			)

			// Our ops trace ID is ours; the customer's trace is separate.
			ctx, span := tracer.Start(r.Context(), name,
				trace.WithNewRoot(),
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(
					attribute.String(AttrOrigin, OriginGateway),
					attribute.String("http.request.method", r.Method),
					attribute.String("url.path", r.URL.Path),
				),
			)
			sc := span.SpanContext()
			if sc.IsValid() {
				w.Header().Set(HeaderTraceID, sc.TraceID().String())
				w.Header().Set(HeaderSpanID, sc.SpanID().String())
			}
			// Stamp our own trace_id/span_id (WithSpanContext reads the active
			// span) plus the customer's observed.trace_id/observed.span_id on
			// the context logger, so every downstream log line carries the
			// correlation.
			ctx = clog.WithSpanContext(ctx)
			ctx = clog.WithObserved(ctx, observedSC)

			rec := &statusRecorder{ResponseWriter: w, status: 200}
			defer func() {
				if rec.status >= 400 {
					span.SetStatus(codes.Error, http.StatusText(rec.status))
				} else {
					span.SetStatus(codes.Ok, "")
				}
				span.SetAttributes(attribute.Int("http.response.status_code", rec.status))
				span.End()
			}()

			next.ServeHTTP(rec, r.WithContext(ctx))
		})
	}
}

// DefaultSpanName maps routes to canonical span names.
func DefaultSpanName(r *http.Request) string {
	switch r.URL.Path {
	case "/v1/chat/completions":
		return "lw_gateway.chat_completions"
	case "/v1/messages":
		return "lw_gateway.messages"
	case "/v1/embeddings":
		return "lw_gateway.embeddings"
	case "/v1/models":
		return "lw_gateway.models"
	}
	return "lw_gateway.request"
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
