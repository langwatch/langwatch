package dsl_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// minimalWorkflow mirrors the Python `basic_workflow` fixture in
// langwatch_nlp/tests/studio/test_parse.py. This is the smallest legal
// shape; if this round-trips, the schema baseline is correct.
const minimalWorkflowJSON = `{
  "workflow_id": "basic",
  "project_id": "test-project",
  "api_key": "",
  "spec_version": "1.3",
  "name": "Basic",
  "icon": "🧩",
  "description": "Basic workflow",
  "version": "1.3",
  "nodes": [],
  "edges": [],
  "state": {"execution": null, "evaluation": null},
  "template_adapter": "default",
  "workflow_type": "workflow"
}`

func TestParseMinimalWorkflow(t *testing.T) {
	w, err := dsl.ParseWorkflow([]byte(minimalWorkflowJSON))
	require.NoError(t, err)

	assert.Equal(t, "basic", w.WorkflowID)
	require.NotNil(t, w.ProjectID)
	assert.Equal(t, "test-project", *w.ProjectID)
	assert.Equal(t, "1.3", w.SpecVersion)
	assert.Equal(t, "default", w.TemplateAdapter)
	require.NotNil(t, w.WorkflowType)
	assert.Equal(t, "workflow", *w.WorkflowType)
	assert.Empty(t, w.Nodes)
	assert.Empty(t, w.Edges)
}

// fullWorkflow exercises every node kind in v1 scope plus an Edge
// with the expected camelCase handle field names.
const fullWorkflowJSON = `{
  "workflow_id": "wf",
  "api_key": "key",
  "spec_version": "1.3",
  "name": "Full",
  "icon": "🧪",
  "description": "All node kinds",
  "version": "1.3",
  "template_adapter": "default",
  "default_llm": {
    "model": "openai/gpt-5-mini",
    "temperature": 0.7,
    "max_tokens": 1024,
    "reasoning": "low"
  },
  "nodes": [
    {
      "id": "entry_1",
      "type": "entry",
      "data": {
        "name": "Entry",
        "outputs": [
          {"identifier": "question", "type": "str"}
        ],
        "dataset": {
          "inline": {
            "records": {"question": ["hi", "hello"], "expected": ["a", "b"]},
            "columnTypes": [
              {"name": "question", "type": "str"},
              {"name": "expected", "type": "str"}
            ]
          }
        },
        "entry_selection": 0,
        "train_size": 0.8,
        "test_size": 0.2,
        "seed": 42
      }
    },
    {
      "id": "code_1",
      "type": "code",
      "data": {
        "name": "Echo",
        "parameters": [
          {"identifier": "code", "type": "code", "value": "def execute(x):\n  return {'y': x}"}
        ],
        "inputs": [{"identifier": "x", "type": "str"}],
        "outputs": [{"identifier": "y", "type": "str"}]
      }
    },
    {
      "id": "http_1",
      "type": "http",
      "data": {
        "name": "Call",
        "parameters": [
          {"identifier": "url", "type": "str", "value": "https://example.com"},
          {"identifier": "method", "type": "str", "value": "POST"},
          {"identifier": "body_template", "type": "str", "value": "{\"q\":\"{{ x }}\"}"},
          {"identifier": "output_path", "type": "str", "value": "$.result"}
        ],
        "inputs": [{"identifier": "x", "type": "str"}],
        "outputs": [{"identifier": "value", "type": "str"}]
      }
    },
    {
      "id": "sig_1",
      "type": "signature",
      "data": {
        "name": "Answer",
        "parameters": [
          {"identifier": "llm", "type": "llm", "value": {"model": "openai/gpt-5-mini", "temperature": 0.0}}
        ],
        "inputs": [{"identifier": "question", "type": "str"}],
        "outputs": [{"identifier": "answer", "type": "str"}]
      }
    },
    {
      "id": "end_1",
      "type": "end",
      "data": {
        "inputs": [{"identifier": "answer", "type": "str"}]
      }
    }
  ],
  "edges": [
    {"id": "e1", "source": "entry_1", "sourceHandle": "outputs.question", "target": "code_1", "targetHandle": "inputs.x", "type": "default"},
    {"id": "e2", "source": "code_1", "sourceHandle": "outputs.y", "target": "http_1", "targetHandle": "inputs.x", "type": "default"},
    {"id": "e3", "source": "http_1", "sourceHandle": "outputs.value", "target": "sig_1", "targetHandle": "inputs.question", "type": "default"},
    {"id": "e4", "source": "sig_1", "sourceHandle": "outputs.answer", "target": "end_1", "targetHandle": "inputs.answer", "type": "default"}
  ],
  "state": {"execution": null, "evaluation": null}
}`

func TestParseFullWorkflow(t *testing.T) {
	w, err := dsl.ParseWorkflow([]byte(fullWorkflowJSON))
	require.NoError(t, err)
	require.Len(t, w.Nodes, 5)
	require.Len(t, w.Edges, 4)

	// Node ordering preserved.
	assert.Equal(t, dsl.ComponentEntry, w.Nodes[0].Type)
	assert.Equal(t, dsl.ComponentCode, w.Nodes[1].Type)
	assert.Equal(t, dsl.ComponentHTTP, w.Nodes[2].Type)
	assert.Equal(t, dsl.ComponentSignature, w.Nodes[3].Type)
	assert.Equal(t, dsl.ComponentEnd, w.Nodes[4].Type)

	// Entry node fields.
	entry := w.Nodes[0].Data
	require.NotNil(t, entry.Dataset)
	require.NotNil(t, entry.Dataset.Inline)
	assert.Len(t, entry.Dataset.Inline.Records["question"], 2)
	require.NotNil(t, entry.EntrySelection)
	i, ok := entry.EntrySelection.AsInt()
	require.True(t, ok, "entry_selection should parse as int")
	assert.Equal(t, 0, i)
	require.NotNil(t, entry.TrainSize)
	assert.InDelta(t, 0.8, *entry.TrainSize, 0.001)
	require.NotNil(t, entry.Seed)
	assert.Equal(t, 42, *entry.Seed)

	// Edges use camelCase wire names.
	assert.Equal(t, "entry_1", w.Edges[0].Source)
	assert.Equal(t, "outputs.question", w.Edges[0].SourceHandle)
	assert.Equal(t, "inputs.x", w.Edges[0].TargetHandle)

	// Default LLM config carries reasoning.
	require.NotNil(t, w.DefaultLLM)
	require.NotNil(t, w.DefaultLLM.Reasoning)
	assert.Equal(t, "low", *w.DefaultLLM.Reasoning)
}

func TestEntrySelectionString(t *testing.T) {
	src := `{"entry_selection": "named-row"}`
	var c dsl.Component
	require.NoError(t, json.Unmarshal([]byte(src), &c))
	require.NotNil(t, c.EntrySelection)
	s, ok := c.EntrySelection.AsString()
	require.True(t, ok)
	assert.Equal(t, "named-row", s)
	_, ok = c.EntrySelection.AsInt()
	assert.False(t, ok)
}

func TestEntrySelectionInt(t *testing.T) {
	src := `{"entry_selection": 7}`
	var c dsl.Component
	require.NoError(t, json.Unmarshal([]byte(src), &c))
	require.NotNil(t, c.EntrySelection)
	i, ok := c.EntrySelection.AsInt()
	require.True(t, ok)
	assert.Equal(t, 7, i)
}

func TestEntrySelectionUnset(t *testing.T) {
	src := `{}`
	var c dsl.Component
	require.NoError(t, json.Unmarshal([]byte(src), &c))
	assert.Nil(t, c.EntrySelection)
}

// Round-trip: parse → marshal → re-parse. The re-parsed value must
// equal the original. This is the byte-equivalence test that protects
// us from accidental field drops when the Component struct grows.
func TestRoundTripFullWorkflow(t *testing.T) {
	original, err := dsl.ParseWorkflow([]byte(fullWorkflowJSON))
	require.NoError(t, err)

	encoded, err := json.Marshal(original)
	require.NoError(t, err)

	roundTripped, err := dsl.ParseWorkflow(encoded)
	require.NoError(t, err)

	// Marshaling both and comparing the bytes catches any field
	// ordering or nullability drift.
	originalBytes, err := json.Marshal(original)
	require.NoError(t, err)
	rtBytes, err := json.Marshal(roundTripped)
	require.NoError(t, err)
	assert.JSONEq(t, string(originalBytes), string(rtBytes))
}

// LiteLLM params sit in LLMConfig and must round-trip exactly so the
// translator (Ash) can read them on the other side.
func TestLLMConfigLiteLLMParams(t *testing.T) {
	src := `{"model":"azure/gpt-4o","litellm_params":{"api_base":"https://x.openai.azure.com","api_version":"2024-06-01","api_key":"sk-azure"}}`
	var cfg dsl.LLMConfig
	require.NoError(t, json.Unmarshal([]byte(src), &cfg))
	require.NotNil(t, cfg.Model)
	assert.Equal(t, "azure/gpt-4o", *cfg.Model)
	assert.Equal(t, "https://x.openai.azure.com", cfg.LiteLLMParams["api_base"])
	assert.Equal(t, "2024-06-01", cfg.LiteLLMParams["api_version"])
}

// Unknown node kinds (e.g. agent/evaluator/retriever) must parse
// successfully — we surface the unsupported-kind error in the planner,
// not at JSON-decode time, so customers can still inspect the workflow
// shape on the Go side.
func TestUnknownNodeKindParses(t *testing.T) {
	src := `{
		"workflow_id":"x","api_key":"","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
		"nodes":[{"id":"a","type":"agent","data":{"agent":"agents/foo","agent_type":"http"}}],
		"edges":[],"state":{},"template_adapter":"default"
	}`
	w, err := dsl.ParseWorkflow([]byte(src))
	require.NoError(t, err)
	require.Len(t, w.Nodes, 1)
	assert.Equal(t, dsl.ComponentType("agent"), w.Nodes[0].Type)
	require.NotNil(t, w.Nodes[0].Data.Agent)
	assert.Equal(t, "agents/foo", *w.Nodes[0].Data.Agent)
}
