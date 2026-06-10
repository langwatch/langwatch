// Per-node OTel span helpers used by both the synchronous (Execute)
// and streaming (ExecuteStream) paths. Spans hang off the request's
// existing trace (set by the handler in adapters/httpapi/tracing.go)
// so the Studio "Full Trace" drawer shows one tree rooted at the
// langwatch-app-minted trace_id with one child per executed node.
//
// Span shape matches the Python langwatch_nlp engine:
//   - name:                node.Data.Name (or node.ID fallback) — e.g.
//     "v1" for an LLM Call named v1. Mirrors Python's
//     DSPy autotracking which names spans by the
//     generated wrapper-module class name. Earlier
//     revisions used the literal "execute_component"
//     for every node, which surfaced 3 identical
//     spans in the Studio drawer for a 3-node
//     workflow (rchaves dogfood 2026-05-14).
//   - langwatch.span.type: "component"                (== Python's optional_langwatch_trace type)
//   - langwatch.input:     JSON-encoded inputs map    (reserved attr; flips Studio output_source from inferred → explicit)
//   - langwatch.output:    JSON-encoded outputs map   (reserved attr; same as above)
//
// Entry + End nodes are pass-throughs (no executor body in runEntry /
// runEnd) so they don't get a span — Python's parsed_and_materialized_
// workflow_class doesn't put @langwatch.span on those wrapper classes
// either. nodeEmitsSpan filters them out at startup so the drawer
// shows only nodes with real work.
//
// See specs/nlp-go/tracing-parity.feature for the contract and
// langwatch_nlp/langwatch_nlp/studio/templates/workflow.py.jinja:47
// for the Python target shape (`@langwatch.span(type="workflow")` on
// the module forward + DSPy autotracking inside).
package engine

import (
	"context"
	"encoding/json"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

const (
	tracerName = "langwatch-nlpgo"

	// componentSpanType is the Python parity value the Studio trace
	// drawer recognizes — sets the row's "Component" type chip.
	componentSpanType = "component"

	// llmSpanType matches the python-sdk reserved value Studio's Trace
	// Details drawer groups by — see langwatch.span.type=="llm" filtering
	// in the trace renderer.
	llmSpanType = "llm"
)

// nodeEmitsSpan reports whether a node kind has a body worth surfacing
// in the trace tree. Entry + End are pass-throughs (runEntry just
// materializes the dataset row, runEnd is a no-op) — they don't get
// their own span on the Python path either (the workflow.py.jinja
// generated wrapper class for those types lacks @langwatch.span). The
// PromptingTechnique node is also a no-op decorator (signature nodes
// apply it inline at LLM-call time). Everything else has actual work
// — LLM call, code execution, HTTP request, evaluator dispatch,
// sub-workflow run.
func nodeEmitsSpan(kind dsl.ComponentType) bool {
	//nolint:exhaustive // intentional default-to-true: only no-op pass-through kinds suppress the span.
	switch kind {
	case dsl.ComponentEntry, dsl.ComponentEnd, dsl.ComponentPromptingTechnique:
		return false
	}
	return true
}

// nodeSpanName returns the span name for a per-node span. Prefers the
// user-set node.Data.Name (e.g. "v1" or "Classify the question") so
// the Studio drawer shows what the operator wrote in the canvas;
// falls back to node.ID for unnamed nodes.
func nodeSpanName(node *dsl.Node) string {
	if node.Data.Name != nil && *node.Data.Name != "" {
		return *node.Data.Name
	}
	return node.ID
}

// startNodeSpan opens a span for one node's dispatch. Span name comes
// from nodeSpanName (user-set node name with id fallback). The per-node
// kind is surfaced via langwatch.node_type. Span also carries the
// workflow-level identity (project_id / origin / thread_id) so it's
// queryable in isolation without joining back to the parent.
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
	//nolint:spancheck // caller (engine.runLayer) owns the span lifecycle and ends it via endNodeSpan.
	return tracer.Start(ctx, nodeSpanName(node),
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

// startLLMSpan opens a child span for one LLM call, parented at the current
// component span. Mirrors the Python langwatch_nlp shape — DSPy's adapter
// emits a `LLM <provider/model>` span with reserved `langwatch.span.type=llm`
// + standard `gen_ai.*` attrs so Studio's Trace Details drawer renders an
// LLM row with model name, token counts, and provider.
//
// The span is opened BEFORE the gateway call so its duration covers the full
// network round-trip (including gateway overhead, not just the upstream
// provider latency). Closed by endLLMSpan, which stamps the response usage
// + output JSON.
func startLLMSpan(ctx context.Context, model, provider string, messages []app.ChatMessage) (context.Context, trace.Span) {
	tracer := otelapi.Tracer(tracerName)
	displayModel := model
	if provider != "" && model != "" {
		displayModel = provider + "/" + model
	}
	attrs := []attribute.KeyValue{
		attribute.String("langwatch.span.type", llmSpanType),
	}
	if provider != "" {
		attrs = append(attrs, attribute.String("gen_ai.system", provider))
	}
	if model != "" {
		attrs = append(attrs, attribute.String("gen_ai.request.model", model))
	}
	if v, ok := encodeJSONAttr(messages); ok {
		attrs = append(attrs, attribute.String("langwatch.input", v))
	}
	//nolint:spancheck // caller owns the span lifecycle and ends it via endLLMSpan.
	return tracer.Start(ctx, displayModel,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attrs...),
	)
}

// endLLMSpan stamps the LLM response shape onto the span and closes it.
// Sets `gen_ai.response.model`, `gen_ai.usage.{input,output}_tokens`,
// `langwatch.cost`, and `langwatch.output` (JSON-encoded response message
// for output_source=explicit rendering in the Studio drawer).
func endLLMSpan(span trace.Span, resp *app.LLMResponse, callErr error) {
	if callErr != nil {
		span.SetStatus(codes.Error, callErr.Error())
		span.SetAttributes(
			attribute.String("error.message", callErr.Error()),
		)
		span.End()
		return
	}
	if resp == nil {
		// (nil, nil) is a contract break — the executor said "no error"
		// but produced no response. Marking it Ok would hide the bug
		// in the trace; flag it as an error so the LLM row in Studio
		// surfaces it.
		const msg = "llm executor returned no response and no error"
		span.SetStatus(codes.Error, msg)
		span.SetAttributes(attribute.String("error.message", msg))
		span.End()
		return
	}
	if resp.Usage.PromptTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.input_tokens", resp.Usage.PromptTokens))
	}
	if resp.Usage.CompletionTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.output_tokens", resp.Usage.CompletionTokens))
	}
	if resp.Usage.ReasoningTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.reasoning_tokens", resp.Usage.ReasoningTokens))
	}
	if resp.Cost > 0 {
		span.SetAttributes(attribute.Float64("langwatch.cost", resp.Cost))
	}
	if resp.DurationMS > 0 {
		span.SetAttributes(attribute.Int64("langwatch.duration_ms", resp.DurationMS))
	}
	// Output: the assistant's reply (matches Python where the LLM span's
	// langwatch.output is the assistant message JSON, not the full HTTP
	// body).
	output := app.ChatMessage{Role: "assistant", Content: resp.Content}
	if resp.Content == "" && len(resp.Messages) > 0 {
		output = resp.Messages[len(resp.Messages)-1]
	}
	if v, ok := encodeJSONAttr(output); ok {
		span.SetAttributes(attribute.String("langwatch.output", v))
	}
	span.SetStatus(codes.Ok, "")
	span.End()
}
