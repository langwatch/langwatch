package integration_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// @scenario "Workflow execution preserves each supported reasoning setting"
// @scenario "Workflow execution resolves conflicting reasoning settings"
// @scenario "Workflow execution omits unset reasoning settings"
func TestWorkflowReasoningSettings(t *testing.T) {
	cases := []struct {
		name     string
		settings string
		want     string
	}{
		{"unified", `"reasoning":"high"`, "high"},
		{"OpenAI", `"reasoning_effort":"high"`, "high"},
		{"Gemini", `"thinkingLevel":"medium"`, "medium"},
		{"Anthropic", `"effort":"max"`, "max"},
		{"unified none", `"reasoning":"none"`, "none"},
		{"OpenAI none", `"reasoning_effort":"none"`, "none"},
		{"Gemini none", `"thinkingLevel":"none"`, "none"},
		{"Anthropic none", `"effort":"none"`, "none"},
		{"unified wins", `"reasoning":"none","reasoning_effort":"high","thinkingLevel":"medium","effort":"low"`, "none"},
		{"OpenAI wins", `"reasoning":"","reasoning_effort":"none","thinkingLevel":"high","effort":"low"`, "none"},
		{"Gemini wins", `"reasoning":null,"reasoning_effort":"","thinkingLevel":"none","effort":"high"`, "none"},
		{"Anthropic fallback", `"reasoning":"","reasoning_effort":null,"thinkingLevel":"","effort":"high"`, "high"},
		{"absent", ``, ""},
		{"null", `"reasoning":null,"reasoning_effort":null,"thinkingLevel":null,"effort":null`, ""},
		{"empty", `"reasoning":"","reasoning_effort":"","thinkingLevel":"","effort":""`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			config := `{"model":"custom/model","max_tokens":65536`
			if tc.settings != "" {
				config += "," + tc.settings
			}
			config += "}"
			wf := &dsl.Workflow{
				WorkflowID: "wf_reasoning",
				Nodes: []dsl.Node{
					{ID: "entry", Type: dsl.ComponentEntry},
					{ID: "sig", Type: dsl.ComponentSignature, Data: dsl.Component{
						Parameters: []dsl.Field{{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: json.RawMessage(config)}},
						Inputs:     []dsl.Field{{Identifier: "question", Type: dsl.FieldTypeStr}},
						Outputs:    []dsl.Field{{Identifier: "answer", Type: dsl.FieldTypeStr}},
					}},
				},
				Edges: []dsl.Edge{{Source: "entry", SourceHandle: "outputs.question", Target: "sig", TargetHandle: "inputs.question"}},
			}
			gw := &reasoningGateway{}
			eng := engine.New(engine.Options{LLM: llmexecutor.New(gw)})
			result, err := eng.Execute(context.Background(), engine.ExecuteRequest{
				Workflow: wf, Inputs: map[string]any{"question": "Is two even?"},
			})
			require.NoError(t, err)
			require.Equal(t, "success", result.Status, "%+v", result.Error)
			var body map[string]json.RawMessage
			require.NoError(t, json.Unmarshal(gw.body, &body))
			if tc.want == "" {
				assert.NotContains(t, body, "reasoning_effort")
			} else {
				assert.JSONEq(t, `"`+tc.want+`"`, string(body["reasoning_effort"]))
			}
			assert.JSONEq(t, `65536`, string(body["max_tokens"]))
			assert.NotContains(t, body, "temperature")
		})
	}
}

type reasoningGateway struct {
	app.GatewayClient
	body []byte
}

func (g *reasoningGateway) ChatCompletions(_ context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	g.body = req.Body
	return &app.GatewayResponse{
		StatusCode: 200,
		Body:       []byte(`{"choices":[{"message":{"role":"assistant","content":"yes"},"finish_reason":"stop"}]}`),
	}, nil
}
