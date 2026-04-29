package engine

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	otelapi "go.opentelemetry.io/otel"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// TestStartLLMSpan_NameAndReservedAttrs locks the LLM span shape Studio's
// Trace Details drawer renders. Pre-fix nlpgo emitted only the parent
// execute_component span — operators saw no model, no tokens, no cost.
// Python parity (DSPy adapter) emits an LLM-typed span named
// "<provider>/<model>" with `langwatch.span.type=llm` plus the standard
// `gen_ai.*` request/usage attrs. This test pins that shape.
func TestStartLLMSpan_NameAndReservedAttrs(t *testing.T) {
	rec := withRecorder(t)

	tracer := otelapi.Tracer(tracerName)
	parentCtx, parent := tracer.Start(context.Background(), componentSpanName)
	defer parent.End()

	messages := []app.ChatMessage{
		{Role: "user", Content: "What is 2+2?"},
	}
	_, llmSpan := startLLMSpan(parentCtx, "gpt-5-mini", "openai", messages)
	endLLMSpan(llmSpan, &app.LLMResponse{
		Content:    "4",
		DurationMS: 3500,
		Cost:       0.00018,
		Usage: app.Usage{
			PromptTokens:     12,
			CompletionTokens: 1,
			TotalTokens:      13,
		},
	}, nil)

	spans := rec.Ended()
	require.Len(t, spans, 1, "endLLMSpan must close exactly one span (parent stays open)")

	got := spans[0]
	assert.Equal(t, "openai/gpt-5-mini", got.Name(),
		"span name must be '<provider>/<model>' so Studio's drawer labels the row 'LLM openai/gpt-5-mini' to match Python parity")

	attrs := attrMap(got.Attributes())
	assert.Equal(t, "llm", attrs["langwatch.span.type"],
		"span.type must be 'llm' — Studio's drawer groups by this exact reserved value to render LLM-flavored rows")
	assert.Equal(t, "openai", attrs["gen_ai.system"])
	assert.Equal(t, "gpt-5-mini", attrs["gen_ai.request.model"])
	assert.EqualValues(t, 12, attrs["gen_ai.usage.input_tokens"])
	assert.EqualValues(t, 1, attrs["gen_ai.usage.output_tokens"])
	assert.InDelta(t, 0.00018, toFloat(attrs["langwatch.cost"]), 1e-9)
	assert.EqualValues(t, 3500, attrs["langwatch.duration_ms"])

	// langwatch.input is the JSON-encoded request messages so Studio's
	// INPUT panel shows the full prompt verbatim (not best-guess).
	inJSON, ok := attrs["langwatch.input"].(string)
	require.True(t, ok, "input must be JSON-encoded for output_source=explicit rendering")
	var inMsgs []app.ChatMessage
	require.NoError(t, json.Unmarshal([]byte(inJSON), &inMsgs))
	require.Len(t, inMsgs, 1)
	assert.Equal(t, "user", inMsgs[0].Role)
	assert.Equal(t, "What is 2+2?", inMsgs[0].Content)

	// langwatch.output is the JSON-encoded assistant message (matches
	// Python's LLM-span output shape — the assistant reply, not the
	// full HTTP response body).
	outJSON, ok := attrs["langwatch.output"].(string)
	require.True(t, ok)
	var outMsg app.ChatMessage
	require.NoError(t, json.Unmarshal([]byte(outJSON), &outMsg))
	assert.Equal(t, "assistant", outMsg.Role)
	assert.Equal(t, "4", outMsg.Content)
}

// TestEndLLMSpan_ErrorPathDoesNotStampOutput pins the error-path
// contract: when the LLM call fails (gateway 401/5xx, network), the span
// captures the error but NOT a fake langwatch.output. Stamping a phantom
// assistant reply for a failed call would mislead operators into thinking
// the value was successfully returned.
func TestEndLLMSpan_ErrorPathDoesNotStampOutput(t *testing.T) {
	rec := withRecorder(t)

	tracer := otelapi.Tracer(tracerName)
	parentCtx, parent := tracer.Start(context.Background(), componentSpanName)
	defer parent.End()

	_, llmSpan := startLLMSpan(parentCtx, "gpt-5-mini", "openai", []app.ChatMessage{
		{Role: "user", Content: "hi"},
	})
	endLLMSpan(llmSpan, nil, errors.New("gateway returned non-2xx status 401"))

	spans := rec.Ended()
	require.Len(t, spans, 1)
	attrs := attrMap(spans[0].Attributes())

	// Input still stamped — operator needs to debug what the failed
	// request looked like.
	assert.Contains(t, attrs, "langwatch.input")
	// Output NOT stamped — there is no real assistant reply on error.
	assert.NotContains(t, attrs, "langwatch.output")
	assert.Contains(t, attrs, "error.message")
	assert.Equal(t, "gateway returned non-2xx status 401", attrs["error.message"])
}

// toFloat coerces an attribute value (recorder serializes numbers as
// float64, but Int/Int64 attributes round-trip as int64).
func toFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int64:
		return float64(x)
	case int:
		return float64(x)
	}
	return 0
}
