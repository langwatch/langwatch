package gatewaytracer

import (
	"net/http"

	"go.uber.org/zap"
	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
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

				// Stamp trace/span on the context logger for all downstream logs.
				ctx = clog.With(ctx,
					zap.String("trace_id", sc.TraceID().String()),
					zap.String("span_id", sc.SpanID().String()),
				)
			}

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
