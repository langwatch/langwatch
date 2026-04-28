package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// tracerName is the OTel instrumentation scope all nlpgo spans live
// under. Mirrors the langwatch-ai-gateway convention.
const tracerName = "langwatch-nlpgo"

// startStudioSpan wraps a Studio execute_* request in a span and primes
// the context with the inbound `workflow.api_key` so otelsetup's
// TenantRouter can route the spans to the right per-tenant exporter.
//
// Trace-ID continuity: Studio generates the trace_id on the frontend
// (useComponentExecution.ts:112) and the langwatch app's "Full Trace"
// drawer queries by that same trace_id. For the trace to land under
// the same id, nlpgo's spans must use the inbound trace_id as the
// root. We construct a remote SpanContext and attach it to ctx; the
// subsequent tracer.Start sees it as the parent and inherits the
// trace_id (with a fresh span_id for our root span).
//
// When the inbound trace_id is malformed or absent, fall through to
// a fresh trace (still better than dropping the request).
func startStudioSpan(ctx context.Context, name string, req *app.WorkflowRequest, workflowAPIKey string) (context.Context, trace.Span) {
	if workflowAPIKey != "" {
		ctx = context.WithValue(ctx, otelsetup.APIKeyContextKey{}, workflowAPIKey)
	}
	if tid, ok := parseTraceID(req.TraceID); ok {
		// Remote=true tells the sampler to honor the inbound decision
		// (we always-sample inbound Studio runs since the langwatch app
		// already gated them).
		sc := trace.NewSpanContext(trace.SpanContextConfig{
			TraceID:    tid,
			SpanID:     newSpanID(),
			TraceFlags: trace.FlagsSampled,
			Remote:     true,
		})
		ctx = trace.ContextWithSpanContext(ctx, sc)
	}
	tracer := otelapi.Tracer(tracerName)
	ctx, span := tracer.Start(ctx, name,
		trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(studioRequestAttrs(req)...),
	)
	return ctx, span
}

func studioRequestAttrs(req *app.WorkflowRequest) []attribute.KeyValue {
	attrs := []attribute.KeyValue{}
	if req.ProjectID != "" {
		attrs = append(attrs, attribute.String("langwatch.project_id", req.ProjectID))
	}
	if req.TraceID != "" {
		attrs = append(attrs, attribute.String("langwatch.trace_id", req.TraceID))
	}
	if req.ThreadID != "" {
		attrs = append(attrs, attribute.String("langwatch.thread_id", req.ThreadID))
	}
	if req.Origin != "" {
		attrs = append(attrs, attribute.String("langwatch.origin", req.Origin))
	}
	if req.NodeID != "" {
		// Only set for execute_component — distinguishes single-node
		// runs in the trace tree at a glance.
		attrs = append(attrs, attribute.String("langwatch.node_id", req.NodeID))
	}
	return attrs
}

// parseTraceID accepts the 32-hex-char trace_id Studio mints and
// returns it as a trace.TraceID. Empty string or malformed input
// returns ok=false so the caller falls through to a fresh trace.
func parseTraceID(s string) (trace.TraceID, bool) {
	if len(s) != 32 {
		return trace.TraceID{}, false
	}
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 16 {
		return trace.TraceID{}, false
	}
	var tid trace.TraceID
	copy(tid[:], b)
	if !tid.IsValid() {
		return trace.TraceID{}, false
	}
	return tid, true
}

// newSpanID returns a random 8-byte span id. crypto/rand because
// span_id collisions across concurrent runs would silently corrupt
// the trace tree.
func newSpanID() trace.SpanID {
	var sid trace.SpanID
	_, _ = rand.Read(sid[:])
	return sid
}
