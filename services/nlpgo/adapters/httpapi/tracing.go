package httpapi

import (
	"context"
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
// studioSpanNameAndType returns the OTel root span name and the
// langwatch.span.type value that match Python's optional_langwatch_trace
// shape per endpoint type.
//
// Naming priority (rchaves dogfood 2026-05-14, second pass):
//  1. workflowName, when set, is the canvas name of the workflow the
//     operator typed in Studio (e.g. "Translation Agent"). When a trace
//     drawer lists three runs of the same workflow, they all share the
//     workflow name — and that is the right grouping for an operator
//     debugging "did my Translation Agent fail?". Mirrors Python's
//     `optional_langwatch_trace(name=workflow.name)` in execute_flow.py.
//  2. When workflowName is empty (sub-workflows that don't carry a name,
//     direct curl tests, malformed payloads), fall back to the event
//     type so the row still has a non-empty label.
//
// langwatch.span.type still switches strictly on the event type so
// Studio's color dispatcher (workflow=blue / evaluation=purple /
// component=green) stays right regardless of the user-typed name:
//
//	execute_flow        → "workflow"
//	execute_evaluation  → "evaluation"
//	execute_component   → "component"
//	default (legacy)    → "workflow"
//
// Earlier revisions used a single hard-coded name ("nlpgo.studio.
// execute_sync" / ".execute_stream") with no span.type, which left
// the Studio drawer rendering the root row with no chip color +
// migration-internal jargon. The first fix moved to event-type names
// (still generic across workflows); this fix completes the rename by
// using the workflow's actual canvas name.
func studioSpanNameAndType(eventType, workflowName string) (name, spanType string) {
	switch eventType {
	case "execute_evaluation":
		spanType = "evaluation"
	case "execute_component":
		spanType = "component"
	case "execute_flow", "":
		spanType = "workflow"
	default:
		spanType = "workflow"
	}
	if workflowName != "" {
		return workflowName, spanType
	}
	switch eventType {
	case "execute_evaluation":
		return "execute_evaluation", spanType
	case "execute_component":
		return "execute_component", spanType
	}
	return "execute_flow", spanType
}

func startStudioSpan(ctx context.Context, req *app.WorkflowRequest, workflowAPIKey string) (context.Context, trace.Span) {
	if workflowAPIKey != "" {
		ctx = context.WithValue(ctx, otelsetup.APIKeyContextKey{}, workflowAPIKey)
	}
	// req.DoNotTrace is the OR of envelope-level event.do_not_trace
	// (set by sub-workflow callers via Python CustomNode.forward /
	// Go agentblock.WorkflowRunner to prevent double-counted spans
	// against the parent trace) and workflow.enable_tracing=false
	// (customer opt-out). Mirrors execute_flow.py:53. When set we
	// return a no-op span so neither this top-level span nor any
	// engine descendants emit — same as Python's
	// optional_langwatch_trace(do_not_trace=True).
	if req.DoNotTrace {
		return ctx, trace.SpanFromContext(ctx)
	}
	// Prefer the W3C-extracted parent span context (set by
	// applyInboundCausality via the global propagator) over the
	// body-supplied req.TraceID. This is what lets evaluator workflows
	// continue the caller's trace end-to-end — same trace_id, parent
	// span_id linked.
	//
	// Fall-back path: when there's no inbound traceparent (Studio's
	// playground frontend ships trace_id in the body only, no W3C
	// headers), seed our context-aware IDGenerator with the body
	// trace_id. The next tracer.Start call sees no valid parent
	// SpanContext, falls into IDGenerator.NewIDs, and gets back
	// (body_trace_id, fresh_span_id). The result is a TRUE root span:
	// trace_id preserved, parent_span_id all-zeros.
	//
	// Earlier code synthesized a remote SpanContext with a random
	// SpanID as a phantom parent — the LangWatch UI then flagged every
	// playground workflow root as "Parent not in trace" because that
	// phantom was never emitted. (2026-05-15 regression.)
	if !trace.SpanContextFromContext(ctx).IsValid() {
		if tid, ok := parseTraceID(req.TraceID); ok {
			ctx = otelsetup.WithTraceIDOverride(ctx, tid)
		}
	}
	spanName, spanType := studioSpanNameAndType(req.Type, req.WorkflowName)
	tracer := otelapi.Tracer(tracerName)
	attrs := studioRequestAttrs(req)
	attrs = append(attrs, attribute.String("langwatch.span.type", spanType))
	//nolint:spancheck // caller (executeSyncHandler) defers span.End() on the returned span.
	ctx, span := tracer.Start(ctx, spanName,
		trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(attrs...),
	)
	return ctx, span //nolint:spancheck // caller (executeSyncHandler) defers span.End() on the returned span.
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
