package engine

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestResolveLLMConfig_FallsBackToWorkflowDefault pins langwatch_nlp
// regression 6d3d8a823 ("defaults for gpt-5 and default model deleting
// during execution"). On the Python path, signature nodes whose `llm`
// parameter is unset rely on the workflow's `default_llm` field. Pre-
// fix, the parser cleared default_llm whenever it couldn't find a
// node with type "llm" — but no node actually carries that type;
// signature nodes carry an `llm` *parameter*. The fallback was
// silently blanked before dispatch.
//
// The Go path must do the same fallback, and crucially the workflow's
// default_llm must reach runSignature so it can be used. resolveLLMConfig
// is the single resolution point.
func TestResolveLLMConfig_FallsBackToWorkflowDefault(t *testing.T) {
	defaultModel := "openai/gpt-5-mini"
	workflow := &dsl.Workflow{
		DefaultLLM: &dsl.LLMConfig{Model: &defaultModel},
	}
	// Signature node with no llm parameter at all — the most common
	// shape when a customer relies on default_llm.
	node := &dsl.Node{
		Type: dsl.ComponentSignature,
		Data: dsl.Component{Parameters: []dsl.Field{}},
	}

	cfg := resolveLLMConfig(node, workflow)
	require.NotNil(t, cfg, "expected fallback to workflow.DefaultLLM")
	require.NotNil(t, cfg.Model)
	assert.Equal(t, defaultModel, *cfg.Model)
}

// TestResolveLLMConfig_FallsBackWhenLLMParamHasNoModel covers the
// "param exists but value is empty/{}" shape Python guards via
// `not llm_param.value`. A parsed-but-modelless config is functionally
// equivalent to no config at all and must fall back.
func TestResolveLLMConfig_FallsBackWhenLLMParamHasNoModel(t *testing.T) {
	defaultModel := "anthropic/claude-haiku-4-5"
	workflow := &dsl.Workflow{
		DefaultLLM: &dsl.LLMConfig{Model: &defaultModel},
	}
	emptyValue := json.RawMessage(`{}`)
	node := &dsl.Node{
		Type: dsl.ComponentSignature,
		Data: dsl.Component{
			Parameters: []dsl.Field{
				{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: emptyValue},
			},
		},
	}

	cfg := resolveLLMConfig(node, workflow)
	require.NotNil(t, cfg)
	require.NotNil(t, cfg.Model)
	assert.Equal(t, defaultModel, *cfg.Model)
}

// TestResolveLLMConfig_FallsBackWhenLLMParamIsNull covers the explicit
// JSON-null shape: `"value": null`. Python's truthiness test catches
// it via the same `not value` guard.
func TestResolveLLMConfig_FallsBackWhenLLMParamIsNull(t *testing.T) {
	defaultModel := "gemini/gemini-2.5-flash"
	workflow := &dsl.Workflow{
		DefaultLLM: &dsl.LLMConfig{Model: &defaultModel},
	}
	node := &dsl.Node{
		Type: dsl.ComponentSignature,
		Data: dsl.Component{
			Parameters: []dsl.Field{
				{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: json.RawMessage(`null`)},
			},
		},
	}

	cfg := resolveLLMConfig(node, workflow)
	require.NotNil(t, cfg)
	require.NotNil(t, cfg.Model)
	assert.Equal(t, defaultModel, *cfg.Model)
}

// TestResolveLLMConfig_NodeLevelWinsOverDefault guards the precedence
// direction: an explicit node-level llm config must NOT be replaced
// by the workflow default. Mirrors Python's check that only fires
// when the node param is absent/falsy.
func TestResolveLLMConfig_NodeLevelWinsOverDefault(t *testing.T) {
	defaultModel := "openai/gpt-5-mini"
	nodeModel := "anthropic/claude-haiku-4-5"
	workflow := &dsl.Workflow{
		DefaultLLM: &dsl.LLMConfig{Model: &defaultModel},
	}
	value, err := json.Marshal(map[string]any{"model": nodeModel})
	require.NoError(t, err)
	node := &dsl.Node{
		Type: dsl.ComponentSignature,
		Data: dsl.Component{
			Parameters: []dsl.Field{
				{Identifier: "llm", Type: dsl.FieldTypeLLM, Value: value},
			},
		},
	}

	cfg := resolveLLMConfig(node, workflow)
	require.NotNil(t, cfg)
	require.NotNil(t, cfg.Model)
	assert.Equal(t, nodeModel, *cfg.Model,
		"node-level llm config must win over workflow.DefaultLLM")
}

// TestResolveLLMConfig_NoFallbackWhenWorkflowHasNoDefault guards the
// "neither set" case — should return nil so runSignature surfaces a
// clean error rather than dispatching a request with empty model.
func TestResolveLLMConfig_NoFallbackWhenWorkflowHasNoDefault(t *testing.T) {
	workflow := &dsl.Workflow{DefaultLLM: nil}
	node := &dsl.Node{
		Type: dsl.ComponentSignature,
		Data: dsl.Component{Parameters: []dsl.Field{}},
	}

	cfg := resolveLLMConfig(node, workflow)
	assert.Nil(t, cfg, "no node llm + no workflow default → nil so dispatch fails fast")
}
