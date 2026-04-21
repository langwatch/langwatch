// Package customertracebridge bridges AI completion spans into the customer's
// distributed trace. It captures the customer's traceparent from the inbound
// request (via middleware), then constructs and exports raw OTLP spans to the
// customer's configured endpoint — completely isolated from the gateway's own
// tracing.
package customertracebridge

import (
	"context"

	"go.opentelemetry.io/otel/trace"
)

type ctxKey struct{}
type spanCtxKey struct{}

// WithTraceParent stashes the customer's raw traceparent header value on the
// context. The middleware should call this after extracting (and stripping) the
// header from the inbound request.
func WithTraceParent(ctx context.Context, traceparent string) context.Context {
	if traceparent == "" {
		return ctx
	}
	return context.WithValue(ctx, ctxKey{}, traceparent)
}

// TraceParent retrieves the customer's traceparent from the context.
// Returns empty string if none was set.
func TraceParent(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKey{}).(string); ok {
		return v
	}
	return ""
}

// withActiveSpan stores the in-flight customer span on the context so EndSpan
// can retrieve and finalise it.
func withActiveSpan(ctx context.Context, span trace.Span) context.Context {
	return context.WithValue(ctx, spanCtxKey{}, span)
}

// activeSpanFrom retrieves the in-flight customer span from context.
func activeSpanFrom(ctx context.Context) trace.Span {
	if v, ok := ctx.Value(spanCtxKey{}).(trace.Span); ok {
		return v
	}
	return nil
}
