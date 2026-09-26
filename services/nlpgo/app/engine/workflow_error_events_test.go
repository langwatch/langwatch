package engine

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// The workflow-level error frame is the only place a failed run names WHY it
// failed in a form the control plane can act on. `error` is engineer-facing
// prose that changes freely; `error_type` is the generated code the client
// looks its customer copy up by. The existing coverage asserted the zap log
// fields and the presence of `error`, so the field the customer's copy hangs
// off could have been dropped from the payload with every Go test still green.

// TestExecuteStream_WorkflowErrorEventCarriesErrorType drives a real node
// failure and reads the frame the control plane reads.
// @scenario "A failed run puts its failure code on the wire"
func TestExecuteStream_WorkflowErrorEventCarriesErrorType(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "wf_error_type",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			// A code node with no runner wired: a deterministic failure that
			// names itself rather than depending on a Python subprocess.
			{ID: "code-1", Type: dsl.ComponentCode},
			// A wired End node keeps this a realistic full-run shape. Without
			// it the planner rejects the workflow outright (#3198) and the test
			// would assert against that error instead of the
			// code_runner_unavailable failure it is actually about. The End node
			// never executes here — code-1 fails first — so the frame under test
			// is unchanged. Same treatment the modelless-signature and
			// ifelse_branching fixtures already got.
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "code-1", TargetHandle: "inputs.input"},
			{Source: "code-1", Target: "end"},
		},
	}

	events, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"input": "boom"},
		TraceID:  "trace_error_type",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	stateEvents := filterByType(drain(events), "execution_state_change")
	require.NotEmpty(t, stateEvents)
	es, ok := stateEvents[len(stateEvents)-1].Payload["execution_state"].(map[string]any)
	require.True(t, ok)

	assert.Equal(t, "error", es["status"])
	assert.Equal(t, "code_runner_unavailable", es["error_type"],
		"the workflow error frame must carry the generated code, not only the engineer-facing message")
	assert.Contains(t, es, "error", "the message rides alongside the code, for the engineer reading a trace")
}

// TestExecuteStream_EvaluationErrorEventCarriesErrorType is the isEval half of
// the same contract: the eval reducer reads a different envelope, and the code
// has to survive that branch too.
// @scenario "A failed evaluation puts its failure code on the wire too"
func TestExecuteStream_EvaluationErrorEventCarriesErrorType(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "wf_eval_error_type",
		APIKey:     "k",
		Nodes: []dsl.Node{
			// No inline dataset, so selectEvaluationEntries rejects the run
			// before any row is iterated — the invalid_dataset path.
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "end", TargetHandle: "inputs.input"},
		},
	}

	events, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"input": "boom"},
		TraceID:  "trace_eval_error_type",
		Type:     "execute_evaluation",
		RunID:    "run_invalid_dataset",
		Origin:   "evaluation",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	evalEvents := filterByType(drain(events), "evaluation_state_change")
	require.NotEmpty(t, evalEvents)
	es, ok := evalEvents[len(evalEvents)-1].Payload["evaluation_state"].(map[string]any)
	require.True(t, ok)

	assert.Equal(t, "error", es["status"])
	assert.Equal(t, "run_invalid_dataset", es["run_id"])
	assert.Equal(t, "invalid_dataset", es["error_type"],
		"a misconfigured dataset is a code the customer has copy for — it must not arrive as an unnamed failure")
}

// TestWorkflowErrorEvent_CarriesTheCodeInBothEnvelopes pins the two remaining
// shapes without going through a run: the canceled-context code, which cannot
// be driven deterministically (emit() selects between the send and ctx.Done(),
// so a canceled run drops the frame about half the time), and the upstream
// status that rides along with an upstream_http_error.
func TestWorkflowErrorEvent_CarriesTheCodeInBothEnvelopes(t *testing.T) {
	req := ExecuteRequest{RunID: "run_canceled"}

	t.Run("when the run is canceled on the flow path", func(t *testing.T) {
		ev := workflowErrorEvent(req, "trace_canceled", &NodeError{
			Type:    "context_canceled",
			Message: "context canceled",
		}, false)

		require.Equal(t, "execution_state_change", ev.Type)
		es, ok := ev.Payload["execution_state"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "error", es["status"])
		assert.Equal(t, "context_canceled", es["error_type"])
		assert.Equal(t, "trace_canceled", es["trace_id"])
	})

	t.Run("when the run is canceled on the evaluation path", func(t *testing.T) {
		ev := workflowErrorEvent(req, "trace_canceled", &NodeError{
			Type:    "context_canceled",
			Message: "context canceled",
		}, true)

		require.Equal(t, "evaluation_state_change", ev.Type)
		es, ok := ev.Payload["evaluation_state"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "error", es["status"])
		assert.Equal(t, "context_canceled", es["error_type"])
		assert.Equal(t, "run_canceled", es["run_id"])
	})

	t.Run("when the failure came from an upstream service", func(t *testing.T) {
		ev := workflowErrorEvent(req, "trace_upstream", &NodeError{
			Type:    "upstream_http_error",
			Message: "502 from https://example.test",
			Status:  502,
		}, false)

		es, ok := ev.Payload["execution_state"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "upstream_http_error", es["error_type"])
		assert.Equal(t, 502, es["upstream_status"],
			"the upstream status is what lets the client say whose fault the failure was")
	})

	t.Run("when the failure carries no code", func(t *testing.T) {
		// A NodeError with no Type is a failure nobody named. It must not put
		// an empty error_type on the wire, because "" is a key the client
		// registry has no entry for and would render as a blank error rather
		// than the generic unknown one.
		ev := workflowErrorEvent(req, "trace_unnamed", &NodeError{Message: "boom"}, false)

		es, ok := ev.Payload["execution_state"].(map[string]any)
		require.True(t, ok)
		assert.NotContains(t, es, "error_type")
		assert.Equal(t, "boom", es["error"])
	})
}
