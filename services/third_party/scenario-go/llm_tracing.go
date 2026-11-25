package scenario

import (
	"context"
	"encoding/json"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// This file records the model calls of the built-in agents (judge, user
// simulator, red-team attacker and scorer, composable voice agent) as LLM
// spans, the counterpart of the AI SDK telemetry the JS SDK turns on for
// them: model, input messages, output, token usage and request parameters.

// modelCallSpanName is the name of a model-call span before the model is
// known; with a model it becomes "chat.<model>", as the LangWatch Go SDK's
// own instrumentation names chat completion spans.
const modelCallSpanName = "chat"

// attrScenarioRole is the attribute naming the scenario role of the agent a
// span belongs to. Agent spans carry it, and so do the judge's model calls,
// so the judge can leave its own calls out of the trace it evaluates.
const attrScenarioRole = "scenario.role"

// TraceInference calls llm.Inference inside an LLM span: the request model,
// sampling parameters, tools, input messages, output message and token usage
// are recorded with the gen_ai / langwatch attributes LangWatch displays.
// When no tracer provider records the span, it only calls the model: no
// attribute is built and no message is encoded.
//
// Custom agents that call a scenario.LLM directly can use it to have their
// model calls show in LangWatch like those of the built-in agents.
func TraceInference(ctx context.Context, llm LLM, params InferenceParams) (*InferenceResult, error) {
	return traceInference(ctx, llm, params, "")
}

// traceInference is TraceInference with the scenario role of the calling
// agent recorded on the span ("" for none).
func traceInference(ctx context.Context, llm LLM, params InferenceParams, role AgentRole) (*InferenceResult, error) {
	if llm == nil {
		return nil, ErrNoModel
	}
	ctx, span := langwatch.Tracer(TracerName, trace.WithInstrumentationVersion(Version)).Start(ctx, modelCallSpanName,
		trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()
	recording := span.IsRecording()
	if recording {
		recordInferenceRequest(span, params, role)
	}
	res, err := llm.Inference(ctx, params)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	if recording && res != nil {
		recordInferenceResult(span, res)
	}
	return res, nil
}

// recordInferenceRequest records what the call asks for, in one
// SetAttributes call.
func recordInferenceRequest(span *langwatch.Span, p InferenceParams, role AgentRole) {
	attrs := make([]attribute.KeyValue, 0, 9)
	attrs = append(attrs,
		langwatch.AttributeLangWatchSpanType.String(string(langwatch.SpanTypeLLM)),
		semconv.GenAIOperationNameChat,
	)
	if p.Model != "" {
		span.SetName(modelCallSpanName + "." + p.Model)
		attrs = append(attrs, semconv.GenAIRequestModelKey.String(p.Model))
	}
	if p.Temperature != nil {
		attrs = append(attrs, semconv.GenAIRequestTemperature(*p.Temperature))
	}
	if p.MaxTokens != nil {
		attrs = append(attrs, semconv.GenAIRequestMaxTokens(int(*p.MaxTokens)))
	}
	if len(p.Tools) > 0 {
		attrs = append(attrs, langwatch.AttributeGenAIRequestTools.String(string(appendToolDefinitions(nil, p.Tools))))
	}
	if p.ToolChoice != nil {
		attrs = append(attrs, langwatch.AttributeGenAIRequestToolChoice.String(string(appendToolChoice(nil, p.ToolChoice))))
	}
	if role != "" {
		attrs = append(attrs, attribute.String(attrScenarioRole, string(role)))
	}
	attrs = append(attrs, langwatch.AttributeLangWatchInput.String(chatMessagesValue(p.Messages)))
	span.SetAttributes(attrs...)
}

// recordInferenceResult records the answer and its token usage.
func recordInferenceResult(span *langwatch.Span, res *InferenceResult) {
	out := res.Message
	if out.Role == "" {
		out.Role = RoleAssistant
	}
	attrs := make([]attribute.KeyValue, 0, 3)
	attrs = append(attrs, langwatch.AttributeLangWatchOutput.String(chatMessagesValue([]Message{out})))
	if u := res.Usage; u != nil {
		attrs = append(attrs,
			semconv.GenAIUsageInputTokens(int(u.InputTokens)),
			semconv.GenAIUsageOutputTokens(int(u.OutputTokens)),
		)
	}
	span.SetAttributes(attrs...)
}

// appendToolDefinitions appends the tools as the JSON array of
// gen_ai.request.tools: [{"type":"function","name":…,"description":…,
// "parameters":…}]. Parameter schemas are user maps of any shape, so they go
// through encoding/json; this only runs for a recorded span.
func appendToolDefinitions(b []byte, tools []ToolDefinition) []byte {
	b = append(b, '[')
	for i, t := range tools {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, `{"type":"function","name":`...)
		b = jsjson.AppendString(b, t.Name)
		if t.Description != "" {
			b = append(b, `,"description":`...)
			b = jsjson.AppendString(b, t.Description)
		}
		if t.Parameters != nil {
			if schema, err := json.Marshal(t.Parameters); err == nil {
				b = append(b, `,"parameters":`...)
				b = append(b, schema...)
			}
		}
		b = append(b, '}')
	}
	return append(b, ']')
}

// appendToolChoice appends the tool choice as JSON: {"type":"auto"} or
// {"type":"tool","toolName":…}, the shape the AI SDK records.
func appendToolChoice(b []byte, c *ToolChoice) []byte {
	b = append(b, `{"type":`...)
	b = jsjson.AppendString(b, string(c.Type))
	if c.Type == ToolChoiceTool {
		b = append(b, `,"toolName":`...)
		b = jsjson.AppendString(b, c.ToolName)
	}
	return append(b, '}')
}

// isJudgeModelCall reports whether a span is a model call the judge made,
// which the judge leaves out of the trace it evaluates: it judges the agents
// of the conversation, not its own reasoning. The JS judge gets the same
// effect within a call because its model-call spans hang under its still
// open agent span; the Go collector ties spans to the thread when they
// start, so the judge filters them by their marker instead.
func isJudgeModelCall(s sdktrace.ReadOnlySpan) bool {
	if s.InstrumentationScope().Name != TracerName {
		return false
	}
	llm, judge := false, false
	for _, kv := range s.Attributes() {
		switch kv.Key {
		case langwatch.AttributeLangWatchSpanType:
			llm = kv.Value.AsString() == string(langwatch.SpanTypeLLM)
		case attrScenarioRole:
			judge = kv.Value.AsString() == string(AgentRoleJudge)
		}
	}
	return llm && judge
}

// withoutJudgeModelCalls returns spans without the judge's own model calls
// and what nests under them (the HTTP span of an instrumented provider
// client, for one). It reuses the slice, which SpansForThread returns as a
// copy, and returns it untouched when the judge made no call yet.
func withoutJudgeModelCalls(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
	var calls map[trace.SpanID]struct{}
	for _, s := range spans {
		if isJudgeModelCall(s) {
			if calls == nil {
				calls = map[trace.SpanID]struct{}{}
			}
			calls[s.SpanContext().SpanID()] = struct{}{}
		}
	}
	if calls == nil {
		return spans
	}
	parents := make(map[trace.SpanID]trace.SpanID, len(spans))
	for _, s := range spans {
		parents[s.SpanContext().SpanID()] = s.Parent().SpanID()
	}
	underCall := func(id trace.SpanID) bool {
		// Bounded by the span count, so a malformed parent cycle ends.
		for range len(spans) + 1 {
			if _, ok := calls[id]; ok {
				return true
			}
			parent, ok := parents[id]
			if !ok {
				return false
			}
			id = parent
		}
		return false
	}
	kept := spans[:0]
	for _, s := range spans {
		if !underCall(s.SpanContext().SpanID()) {
			kept = append(kept, s)
		}
	}
	clear(spans[len(kept):])
	return kept
}
