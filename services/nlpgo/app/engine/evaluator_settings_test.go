package engine

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// dispatchEvaluatorBody runs a minimal entry -> evaluator workflow against a
// stub standing in for POST /api/evaluations/<slug>/evaluate and returns the
// body the engine sent. Settings are the top precedence layer of that
// endpoint's merge, so the body is exactly what the evaluator runs on.
func dispatchEvaluatorBody(t *testing.T, parameters []dsl.Field) map[string]any {
	t.Helper()
	return dispatchEvaluatorNode(t, dsl.Component{Parameters: parameters})
}

// dispatchEvaluatorNode is the same hop for a node whose `data` carries more
// than its parameters.
func dispatchEvaluatorNode(t *testing.T, data dsl.Component) map[string]any {
	t.Helper()

	var captured map[string]any
	var captureErr error
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, readErr := io.ReadAll(r.Body)
		if readErr != nil {
			captureErr = readErr
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if decodeErr := json.Unmarshal(raw, &captured); decodeErr != nil {
			captureErr = decodeErr
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "processed",
			"passed": true,
		})
	}))
	t.Cleanup(srv.Close)

	evalSlug := "langevals/llm_boolean"
	nodeData := data
	if nodeData.Evaluator == nil {
		nodeData.Evaluator = &evalSlug
	}
	if nodeData.Outputs == nil {
		nodeData.Outputs = []dsl.Field{{Identifier: "passed"}}
	}
	eng := New(Options{
		Evaluator:        evaluatorblock.New(evaluatorblock.Options{}),
		LangWatchBaseURL: srv.URL,
	})

	wf := &dsl.Workflow{
		WorkflowID: "evaluator_settings",
		APIKey:     "test-key",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{
				ID:   "evaluator-1",
				Type: dsl.ComponentEvaluator,
				Data: nodeData,
			},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.output", Target: "evaluator-1", TargetHandle: "inputs.output"},
		},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"output": "yes"},
	})
	require.NoError(t, err)
	require.Contains(t, res.Nodes, "evaluator-1")
	require.Equal(t, "success", res.Nodes["evaluator-1"].Status,
		"evaluator node should succeed against the stub server")
	require.NoError(t, captureErr, "stub could not read the request body")
	require.NotNil(t, captured, "stub never received a request body")
	return captured
}

// param builds one flattened parameter the way mergeEvaluatorLocalConfig does:
// `type: "str"` regardless of the value's JSON type.
func param(t *testing.T, identifier string, value any) dsl.Field {
	t.Helper()
	raw, err := json.Marshal(value)
	require.NoError(t, err)
	return dsl.Field{Identifier: identifier, Type: "str", Value: raw}
}

// TestDispatchEvaluator_FlattenedParametersBecomeSettings is the bug: an
// evaluator configured inline on the canvas reaches the engine as one
// parameter per setting key, never as a `settings` dict, so reading only
// `settings` left the field off the outbound body and the evaluator ran on
// its saved defaults. Every setting was lost, not just the model.
func TestDispatchEvaluator_FlattenedParametersBecomeSettings(t *testing.T) {
	body := dispatchEvaluatorBody(t, []dsl.Field{
		param(t, "model", "openai/gpt-5-mini"),
		param(t, "max_tokens", 256),
		param(t, "prompt", "Is the answer correct?"),
	})

	settings, ok := body["settings"].(map[string]any)
	require.True(t, ok, "settings missing from the outbound body: %v", body)
	assert.Equal(t, "openai/gpt-5-mini", settings["model"])
	assert.EqualValues(t, 256, settings["max_tokens"])
	assert.Equal(t, "Is the answer correct?", settings["prompt"])
}

// TestDispatchEvaluator_LegacySettingsDictStillWorks keeps the pre-Go-port
// shape evaluating: a workflow persisted with every setting under a single
// `settings` dict parameter.
func TestDispatchEvaluator_LegacySettingsDictStillWorks(t *testing.T) {
	body := dispatchEvaluatorBody(t, []dsl.Field{
		{Identifier: "evaluator", Type: "str", Value: json.RawMessage(`"langevals/llm_boolean"`)},
		{Identifier: "name", Type: "str", Value: json.RawMessage(`"is-answer-correct"`)},
		{Identifier: "settings", Type: "dict", Value: json.RawMessage(`{"model":"openai/gpt-5-mini","max_tokens":128}`)},
	})

	settings, ok := body["settings"].(map[string]any)
	require.True(t, ok, "settings missing from the outbound body: %v", body)
	assert.Equal(t, "openai/gpt-5-mini", settings["model"])
	assert.EqualValues(t, 128, settings["max_tokens"])

	// The dispatch identifiers are not settings: they are read in their own
	// right and must not reach the evaluator's merge.
	assert.NotContains(t, settings, "evaluator")
	assert.NotContains(t, settings, "name")
	assert.Equal(t, "is-answer-correct", body["name"])
}

// TestDispatchEvaluator_FlattenedOverlaysLegacyDict pins the precedence when a
// node carries both shapes: the flattened entries are the fresher inline edit,
// so they win, and the dict's other keys survive.
func TestDispatchEvaluator_FlattenedOverlaysLegacyDict(t *testing.T) {
	body := dispatchEvaluatorBody(t, []dsl.Field{
		{Identifier: "settings", Type: "dict", Value: json.RawMessage(`{"model":"openai/gpt-5-nano","max_tokens":128}`)},
		param(t, "model", "openai/gpt-5-mini"),
	})

	settings, ok := body["settings"].(map[string]any)
	require.True(t, ok, "settings missing from the outbound body: %v", body)
	assert.Equal(t, "openai/gpt-5-mini", settings["model"],
		"the flattened parameter is the fresher edit and must win over the dict")
	assert.EqualValues(t, 128, settings["max_tokens"], "a dict key with no flattened twin survives")
}

// TestDispatchEvaluator_NoSettingsOmitsTheField keeps the saved-evaluator path
// intact: a node that only points at a saved evaluator must send no settings
// at all, so the endpoint's merge falls through to the stored config rather
// than being overridden by an empty top layer.
func TestDispatchEvaluator_NoSettingsOmitsTheField(t *testing.T) {
	body := dispatchEvaluatorBody(t, nil)

	assert.NotContains(t, body, "settings",
		"a node with no settings must not override the saved evaluator config")
}

// TestEvaluatorSettings_SkipsValuelessParameters guards the assembly against a
// parameter the author left empty: an unset value is absent, not null, so it
// cannot blank a saved setting.
func TestEvaluatorSettings_SkipsValuelessParameters(t *testing.T) {
	settings := evaluatorSettings([]dsl.Field{
		{Identifier: "model", Type: "str"},
		param(t, "max_tokens", 64),
	})

	assert.NotContains(t, settings, "model")
	assert.EqualValues(t, 64, settings["max_tokens"])
}

// TestEvaluatorSettings_SkipsNullParameters is the other half of the same
// claim: a null is as absent as a missing value. No evaluator's settings
// schema accepts one, so forwarding a null would refuse the whole evaluate
// call instead of leaving the stored setting standing.
func TestEvaluatorSettings_SkipsNullParameters(t *testing.T) {
	settings := evaluatorSettings([]dsl.Field{
		{Identifier: "settings", Type: "dict", Value: json.RawMessage(`{"model":"openai/gpt-5-mini"}`)},
		{Identifier: "model", Type: "str", Value: json.RawMessage(`null`)},
		param(t, "max_tokens", 64),
	})

	assert.Equal(t, "openai/gpt-5-mini", settings["model"], "a null must not blank the stored setting")
	assert.EqualValues(t, 64, settings["max_tokens"])
}

// TestDispatchEvaluator_NameIsNotASetting is the hazard the assembly adds:
// settings now come from parameters[], so a reserved identifier left in that
// slice would travel as a setting. The per-evaluator schemas are not strict,
// so the endpoint's parse would quietly drop it rather than refuse the call,
// which is why the exclusion is pinned here instead. The name keeps going out
// as the body's own field, as it always did.
func TestDispatchEvaluator_NameIsNotASetting(t *testing.T) {
	body := dispatchEvaluatorBody(t, []dsl.Field{
		{Identifier: "name", Type: "str", Value: json.RawMessage(`"is-answer-correct"`)},
		param(t, "model", "openai/gpt-5-mini"),
	})

	assert.Equal(t, "is-answer-correct", body["name"])
	settings, ok := body["settings"].(map[string]any)
	require.True(t, ok, "settings missing from the outbound body: %v", body)
	assert.NotContains(t, settings, "name")
	assert.Equal(t, "openai/gpt-5-mini", settings["model"])
}
