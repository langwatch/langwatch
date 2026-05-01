package engine

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// fakeLLMClient is a deterministic stub the engine treats as a real
// gateway dispatcher. Test workflows use it to exercise the signature
// node + LLM span emission path without standing up Bifrost.
type fakeLLMClient struct {
	resp *app.LLMResponse
	err  error
}

func (f *fakeLLMClient) Execute(_ context.Context, _ app.LLMRequest) (*app.LLMResponse, error) {
	return f.resp, f.err
}
func (f *fakeLLMClient) ExecuteStream(_ context.Context, _ app.LLMRequest) (app.StreamIterator, error) {
	return nil, nil
}

// TestEngineExecute_SignatureNodeEmitsLLMChildSpan is the end-to-end
// proof that runSignature wraps the gateway call in an LLM-typed child
// span. Pre-fix the only span was the parent execute_component — Studio's
// Trace Details drawer (rchaves screenshot 2026-04-29) showed no model,
// no token count, no cost. Python parity emits a `<provider>/<model>`
// span at this level with reserved gen_ai.* attrs.
func TestEngineExecute_SignatureNodeEmitsLLMChildSpan(t *testing.T) {
	rec := withRecorder(t)

	model := "openai/gpt-5-mini"
	llm := &fakeLLMClient{
		resp: &app.LLMResponse{
			Content:    "4",
			DurationMS: 1234,
			Cost:       0.00018,
			Usage: app.Usage{
				PromptTokens:     12,
				CompletionTokens: 1,
				TotalTokens:      13,
			},
		},
	}

	eng := New(Options{LLM: llm})
	llmConfigJSON, err := json.Marshal(map[string]any{"model": model})
	require.NoError(t, err)

	wf := &dsl.Workflow{
		WorkflowID: "wf_llm_span",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				Outputs: []dsl.Field{{Identifier: "question", Type: dsl.FieldTypeStr}},
			}},
			{ID: "answer", Type: dsl.ComponentSignature, Data: dsl.Component{
				Parameters: []dsl.Field{
					{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: llmConfigJSON},
				},
				Inputs:  []dsl.Field{{Identifier: "question", Type: dsl.FieldTypeStr}},
				Outputs: []dsl.Field{{Identifier: "answer", Type: dsl.FieldTypeStr}},
			}},
			{ID: "end", Type: dsl.ComponentEnd, Data: dsl.Component{
				Inputs: []dsl.Field{{Identifier: "answer", Type: dsl.FieldTypeStr}},
			}},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.question", Target: "answer", TargetHandle: "inputs.question"},
			{Source: "answer", SourceHandle: "outputs.answer", Target: "end", TargetHandle: "inputs.answer"},
		},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"question": "What is 2+2?"},
	})
	require.NoError(t, err)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	spans := rec.Ended()
	require.NotEmpty(t, spans, "expected spans for entry, answer, end + answer's LLM child")

	var componentSpans, llmSpans int
	var llmAttrs map[string]any
	var llmSpanID string
	var componentSpanID string
	for _, s := range spans {
		attrs := attrMap(s.Attributes())
		switch attrs["langwatch.span.type"] {
		case "component":
			componentSpans++
			if attrs["langwatch.node_id"] == "answer" {
				componentSpanID = s.SpanContext().SpanID().String()
			}
		case "llm":
			llmSpans++
			llmAttrs = attrs
			llmSpanID = s.Parent().SpanID().String()
			assert.Equal(t, "openai/gpt-5-mini", s.Name(),
				"LLM span name must be '<provider>/<model>' for Studio's drawer to render the LLM row label")
		}
	}

	assert.Equal(t, 3, componentSpans,
		"one execute_component span per dispatched node (entry, answer, end)")
	require.Equal(t, 1, llmSpans, "signature node must emit exactly one LLM child span")
	assert.Equal(t, componentSpanID, llmSpanID,
		"LLM span must be parented at the answer node's execute_component span — Studio's tree view nests on parent span_id")

	// Reserved gen_ai attrs Studio reads to render token counts + cost.
	assert.Equal(t, "openai", llmAttrs["gen_ai.system"])
	assert.Equal(t, "gpt-5-mini", llmAttrs["gen_ai.request.model"])
	assert.EqualValues(t, 12, llmAttrs["gen_ai.usage.input_tokens"])
	assert.EqualValues(t, 1, llmAttrs["gen_ai.usage.output_tokens"])
	assert.InDelta(t, 0.00018, toFloat(llmAttrs["langwatch.cost"]), 1e-9)
}
