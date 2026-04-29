// Per-node OTel span helpers used by both the synchronous (Execute)
// and streaming (ExecuteStream) paths. Spans hang off the request's
// existing trace (set by the handler in adapters/httpapi/tracing.go)
// so the Studio "Full Trace" drawer shows one tree rooted at the
// langwatch-app-minted trace_id with one child per executed node.
package engine

import (
	"context"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

const tracerName = "langwatch-nlpgo"

// startNodeSpan opens a span for one node's dispatch. Span name is
// `nlpgo.node.<type>` (e.g. nlpgo.node.code, nlpgo.node.signature) so
// trace explorers can filter to a single node kind. Attributes carry
// the workflow-level identity (project_id / origin / thread_id) so the
// span is queryable in isolation without joining back to the parent.
func startNodeSpan(ctx context.Context, node *dsl.Node, req ExecuteRequest) (context.Context, trace.Span) {
	tracer := otelapi.Tracer(tracerName)
	attrs := []attribute.KeyValue{
		attribute.String("langwatch.node_id", node.ID),
		attribute.String("langwatch.node_type", string(node.Type)),
	}
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
	return tracer.Start(ctx, "nlpgo.node."+string(node.Type),
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attrs...),
	)
}

// endNodeSpan closes a node span and stamps the dispatch outcome.
// Error spans get the structured node-error type/message (matches the
// `error.type` semconv shape) so trace search by error class works.
func endNodeSpan(span trace.Span, ns *NodeState, derr *NodeError) {
	if derr != nil {
		span.SetStatus(codes.Error, derr.Message)
		span.SetAttributes(
			attribute.String("error.type", derr.Type),
			attribute.String("error.message", derr.Message),
		)
	} else {
		span.SetStatus(codes.Ok, "")
	}
	if ns != nil && ns.DurationMS > 0 {
		span.SetAttributes(attribute.Int64("langwatch.duration_ms", ns.DurationMS))
	}
	if ns != nil && ns.Cost > 0 {
		span.SetAttributes(attribute.Float64("langwatch.cost", ns.Cost))
	}
	span.End()
}
