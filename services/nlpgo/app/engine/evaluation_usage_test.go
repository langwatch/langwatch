package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestExecuteStream_EvaluationProgressCarriesEachRowsLLMUsage proves every
// evaluated row's LLM token usage reaches the wire once, on that row's progress
// event, with the row's own trace id: the evaluation stream has no per-node
// events, and the control plane writes these counts to the spend ledger.
// @scenario "An evaluated studio row reports its LLM usage on its own progress event"
func TestExecuteStream_EvaluationProgressCarriesEachRowsLLMUsage(t *testing.T) {
	results := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(results.Close)

	llm := &fakeLLMClient{resp: &app.LLMResponse{Content: "4", Usage: app.Usage{
		PromptTokens: 30, CompletionTokens: 5, TotalTokens: 35, CacheReadInputTokens: 10,
	}}}
	eng := New(Options{LLM: llm, LangWatchBaseURL: results.URL})
	llmConfigJSON, err := json.Marshal(map[string]any{"model": "openai/gpt-5-mini"})
	require.NoError(t, err)

	wf := &dsl.Workflow{
		WorkflowID: "wf_eval_usage",
		APIKey:     "k",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				Outputs: []dsl.Field{{Identifier: "question", Type: dsl.FieldTypeStr}},
				Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
					Records: map[string][]any{"question": {"2+2?", "3+1?"}},
				}},
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

	events, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow:   wf,
		TraceID:    "trace_eval_usage",
		Type:       "execute_evaluation",
		RunID:      "run_usage",
		EvaluateOn: "full",
		Origin:     "evaluation",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	var usage []map[string]any
	for _, ev := range filterByType(drain(events), "evaluation_state_change") {
		if rows, ok := ev.Payload["usage"].([]map[string]any); ok {
			usage = append(usage, rows...)
		}
	}

	require.Len(t, usage, 2, "each of the two rows reports its one LLM node once")
	traceIDs := map[any]bool{}
	for _, row := range usage {
		assert.Equal(t, "answer", row["node_id"])
		metrics, ok := row["metrics"].(*NodeMetrics)
		require.True(t, ok)
		assert.Equal(t, 30, metrics.PromptTokens)
		assert.Equal(t, 10, metrics.CacheReadInputTokens)
		assert.Equal(t, "openai/gpt-5-mini", metrics.Model)
		assert.NotEqual(t, "trace_eval_usage", row["trace_id"], "a row runs under its own trace")
		traceIDs[row["trace_id"]] = true
	}
	assert.Len(t, traceIDs, 2, "the two rows carry distinct trace ids")
}

func TestNodeUsages_SkipsNodesWithoutMetrics(t *testing.T) {
	got := nodeUsages(&ExecuteResult{TraceID: "t", Nodes: map[string]*NodeState{
		"b":     {ID: "b", Metrics: &NodeMetrics{PromptTokens: 1, Model: "openai/x"}, DurationMS: 7},
		"entry": {ID: "entry"},
		"a":     {ID: "a", Metrics: &NodeMetrics{CompletionTokens: 2, Model: "openai/y"}},
	}})
	require.Len(t, got, 2)
	assert.Equal(t, "a", got[0]["node_id"])
	assert.Equal(t, "b", got[1]["node_id"])
	assert.EqualValues(t, 7, got[1]["duration_ms"])
	assert.Nil(t, nodeUsages(nil))
}
