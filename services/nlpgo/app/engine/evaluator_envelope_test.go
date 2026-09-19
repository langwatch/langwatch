package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// newEvaluatorEnvelopeStub answers the LangWatch evaluator API with a full
// EvaluationResultWithMetadata envelope, including a non-empty `details`
// reasoning string — the field the regression silently dropped.
func newEvaluatorEnvelopeStub(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "processed",
			"score":   1,
			"passed":  true,
			"label":   "exact",
			"details": "true == 1",
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

// runEvaluatorNodeOutputs executes a minimal entry -> evaluator workflow and
// returns the evaluator node's surfaced outputs. The evaluator node declares
// only the given value-output names — mirroring experiments-v3's
// workflowBuilder, which declares [passed, score, label] and never lists the
// metadata envelope.
func runEvaluatorNodeOutputs(t *testing.T, declaredOutputs []string) map[string]any {
	t.Helper()
	srv := newEvaluatorEnvelopeStub(t)
	eng := New(Options{
		Evaluator:        evaluatorblock.New(evaluatorblock.Options{}),
		LangWatchBaseURL: srv.URL,
	})

	evalSlug := "langevals/exact_match"
	declared := make([]dsl.Field, 0, len(declaredOutputs))
	for _, id := range declaredOutputs {
		declared = append(declared, dsl.Field{Identifier: id})
	}

	wf := &dsl.Workflow{
		WorkflowID: "evaluator_envelope",
		APIKey:     "test-key",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{
				ID:   "evaluator-1",
				Type: dsl.ComponentEvaluator,
				Data: dsl.Component{
					Evaluator: &evalSlug,
					Outputs:   declared,
				},
			},
			// End node required by the missing-End planner guard (#3198);
			// assertions below read the evaluator node's outputs, not the
			// workflow result, so the pass-through End is harmless.
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.output", Target: "evaluator-1", TargetHandle: "inputs.output"},
			{Source: "entry", SourceHandle: "outputs.expected_output", Target: "evaluator-1", TargetHandle: "inputs.expected_output"},
			{Source: "evaluator-1", Target: "end"},
		},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"output": "true", "expected_output": "1"},
	})
	require.NoError(t, err)
	require.Contains(t, res.Nodes, "evaluator-1")
	require.Equal(t, "success", res.Nodes["evaluator-1"].Status,
		"evaluator node should succeed against the stub server")
	return res.Nodes["evaluator-1"].Outputs
}

// TestRunEvaluator_EnvelopeSurvivesDeclaredOutputs pins the parity fix: the
// EvaluationResultWithMetadata envelope (status/details/cost) is surfaced even
// when the node declares only its value outputs. Before the fix, the declared-
// names filter dropped `details`, erasing the reasoning from the workbench
// result popover and the batch eval report.
//
// @scenario Reasoning survives when the evaluator node declares only value outputs
func TestRunEvaluator_EnvelopeSurvivesDeclaredOutputs(t *testing.T) {
	outputs := runEvaluatorNodeOutputs(t, []string{"passed", "score", "label"})

	// The envelope reasoning — the regressed field — must be present.
	require.Equal(t, "true == 1", outputs["details"],
		"evaluator reasoning (details) must survive even though the node never declares it")
	assert.Equal(t, "processed", outputs["status"],
		"status envelope field must survive the declared-outputs filter")

	// Declared value fields still flow through.
	assert.Equal(t, true, outputs["passed"])
	assert.EqualValues(t, 1, outputs["score"])
	assert.Equal(t, "exact", outputs["label"])
}

// TestRunEvaluator_FiltersUndeclaredValueOutputsButKeepsEnvelope pins the other
// half of the contract: value outputs the author did NOT declare are still
// filtered (respecting "a workflow that only wires passed"), while the metadata
// envelope is always surfaced.
//
// @scenario Undeclared value outputs are filtered while the envelope is kept
func TestRunEvaluator_FiltersUndeclaredValueOutputsButKeepsEnvelope(t *testing.T) {
	outputs := runEvaluatorNodeOutputs(t, []string{"passed"})

	// Declared value field present.
	assert.Equal(t, true, outputs["passed"])

	// Undeclared value fields filtered out.
	_, hasScore := outputs["score"]
	_, hasLabel := outputs["label"]
	assert.False(t, hasScore, "undeclared score must be filtered")
	assert.False(t, hasLabel, "undeclared label must be filtered")

	// Envelope metadata always surfaced regardless of declarations.
	require.Equal(t, "true == 1", outputs["details"],
		"reasoning must survive even when only [passed] is declared")
	assert.Equal(t, "processed", outputs["status"])
}
