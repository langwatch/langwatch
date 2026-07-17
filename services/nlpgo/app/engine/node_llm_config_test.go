package engine

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// Nodes own their LLM config (DSL spec_version 1.5): there is no
// workflow-level default_llm fallback in the engine. paramLLMConfig is
// the single place a signature node's config is read from, and
// runSignature fails with the typed llm_model_not_set NodeError when no
// usable model is present — the app materializes models at save time
// and migrates legacy DSLs on read, so a miss here is stale client
// state, never a normal shape.

func TestParamLLMConfig_ReadsNodeLevelConfig(t *testing.T) {
	nodeModel := "anthropic/claude-haiku-4-5"
	value, err := json.Marshal(map[string]any{"model": nodeModel})
	require.NoError(t, err)

	cfg := paramLLMConfig([]dsl.Field{
		{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: value},
	})
	require.NotNil(t, cfg)
	require.NotNil(t, cfg.Model)
	assert.Equal(t, nodeModel, *cfg.Model)
}

func TestParamLLMConfig_NilWhenParamMissing(t *testing.T) {
	cfg := paramLLMConfig([]dsl.Field{})
	assert.Nil(t, cfg, "no llm parameter → nil so runSignature fails fast")
}

func TestParamLLMConfig_EmptyObjectYieldsNoModel(t *testing.T) {
	cfg := paramLLMConfig([]dsl.Field{
		{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: json.RawMessage(`{}`)},
	})
	// An empty object parses but carries no model — runSignature's model
	// guard treats it the same as a missing parameter.
	if cfg != nil {
		assert.Nil(t, cfg.Model)
	}
}

func TestParamLLMConfig_NullValueYieldsNoModel(t *testing.T) {
	cfg := paramLLMConfig([]dsl.Field{
		{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: json.RawMessage(`null`)},
	})
	if cfg != nil {
		assert.Nil(t, cfg.Model)
	}
}

// The engine-level guard: a signature node with no usable model fails
// with the typed llm_model_not_set error instead of dispatching an
// empty model for the gateway to 400 on.
func TestRunSignature_FailsClearlyWithoutModel(t *testing.T) {
	core, _ := observer.New(zapcore.DebugLevel)
	ctx := clog.Set(context.Background(), zap.New(core))
	// The LLM executor is wired but must never be reached.
	eng := New(Options{LLM: &statusFailingLLM{err: &statusErr{msg: "llm must not be called", status: 500}}})

	res, err := eng.Execute(ctx, ExecuteRequest{
		Workflow: modellessSignatureWorkflow(),
		Inputs:   map[string]any{"q": "hi"},
		TraceID:  "trace_modelless",
	})
	require.NoError(t, err)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "llm_model_not_set", res.Error.Type,
		"typed sentinel so the app can render a specific, fixable error")
	assert.Contains(t, res.Error.Message, "no model selected")
	assert.Equal(t, "sig", res.Error.NodeID)
}

func modellessSignatureWorkflow() *dsl.Workflow {
	return &dsl.Workflow{
		WorkflowID: "wf_modelless",
		APIKey:     "k",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "sig", Type: dsl.ComponentSignature, Data: dsl.Component{
				Inputs:  []dsl.Field{{Identifier: "q", Type: "str"}},
				Outputs: []dsl.Field{{Identifier: "answer", Type: "str"}},
			}},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.q", Target: "sig", TargetHandle: "inputs.q"},
		},
	}
}
