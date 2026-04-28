// Per-node OTel span helpers used by both the synchronous (Execute)
// and streaming (ExecuteStream) paths. Spans hang off the request's
// existing trace (set by the handler in adapters/httpapi/tracing.go)
// so the Studio "Full Trace" drawer shows one tree rooted at the
// langwatch-app-minted trace_id with one child per executed node.
//
// Span shape matches the Python langwatch_nlp engine:
//   - name:                "execute_component"        (== Python's optional_langwatch_trace name)
//   - langwatch.span.type: "component"                (== Python's optional_langwatch_trace type)
//   - langwatch.input:     JSON-encoded inputs map    (reserved attr; flips Studio output_source from inferred → explicit)
//   - langwatch.output:    JSON-encoded outputs map   (reserved attr; same as above)
// See specs/nlp-go/tracing-parity.feature for the contract and
// langwatch_nlp/langwatch_nlp/studio/execute/execute_component.py for
// the Python target shape.
package engine

import (
	"context"
	"encoding/json"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

const (
	tracerName = "langwatch-nlpgo"

	// componentSpanName matches Python's optional_langwatch_trace(name=…).
	// Renaming it would break Studio filters that group "all component
	// dispatches" by span name across the Python and Go engines.
	componentSpanName = "execute_component"
	componentSpanType = "component"
)

// startNodeSpan opens a span for one node's dispatch. Span name is
// always "execute_component" (Python parity); the per-node type is
// surfaced via langwatch.node_type. The span carries the workflow-level
// identity (project_id / origin / thread_id) so it's queryable in
// isolation without joining back to the parent.
func startNodeSpan(ctx context.Context, node *dsl.Node, req ExecuteRequest) (context.Context, trace.Span) {
	tracer := otelapi.Tracer(tracerName)
	attrs := []attribute.KeyValue{
		attribute.String("langwatch.span.type", componentSpanType),
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
	return tracer.Start(ctx, componentSpanName,
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attrs...),
	)
}

// endNodeSpan closes a node span and stamps the dispatch outcome plus
// reserved langwatch.input / langwatch.output attributes (JSON-encoded
// per python-sdk attributes.py). Setting these flips the trace's
// output_source from "inferred" to "explicit" — i.e. the Studio Trace
// Details drawer renders the actual values instead of best-guess JSON
// from the response body.
//
// On error: input is still stamped (for debugging the failed call) but
// output is not (would be misleading). Span status is codes.Error.
func endNodeSpan(span trace.Span, ns *NodeState, derr *NodeError) {
	if ns != nil && ns.Inputs != nil {
		if v, ok := encodeJSONAttr(ns.Inputs); ok {
			span.SetAttributes(attribute.String("langwatch.input", v))
		}
	}
	if derr != nil {
		span.SetStatus(codes.Error, derr.Message)
		span.SetAttributes(
			attribute.String("error.type", derr.Type),
			attribute.String("error.message", derr.Message),
		)
	} else {
		if ns != nil && ns.Outputs != nil {
			if v, ok := encodeJSONAttr(ns.Outputs); ok {
				span.SetAttributes(attribute.String("langwatch.output", v))
			}
		}
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

// encodeJSONAttr marshals v to JSON. Returns ok=false on marshal
// error so the caller skips the attribute. No truncation: agent
// outputs are sometimes large and operators want the full content;
// downstream limits (OTLP exporter body size, ClickHouse storage)
// are the right place to enforce caps if needed, not here.
func encodeJSONAttr(v any) (string, bool) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", false
	}
	return string(b), true
}
