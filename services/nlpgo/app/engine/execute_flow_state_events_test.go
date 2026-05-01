package engine

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestExecuteStream_EmitsWorkflowExecutionStateEvents pins the SSE event
// contract Studio's `usePostEvent.tsx` reducer requires for
// `execute_flow` runs. Pre-fix nlpgo emitted only per-node
// `component_state_change` events plus a final `done` — the workflow
// itself never moved out of the "waiting" status that
// `startWorkflowExecution` sets client-side, so the 20-second
// `triggerTimeout` fired and the user saw "Timeout starting workflow
// execution" even when every node had succeeded on the wire (rchaves
// dogfood 2026-04-29 trace 60f59f73…).
//
// Mirror python langwatch_nlp's start_workflow_event /
// end_workflow_event in execute_flow.py: emit `execution_state_change`
// with status=running on entry, status=success on completion (or
// status=error on failure) so Studio's reducer flips
// workflow.state.execution.status.
func TestExecuteStream_EmitsWorkflowExecutionStateEvents(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "wf_state_events",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "end", TargetHandle: "inputs.output"},
		},
	}

	events, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"input": "hello"},
		TraceID:  "trace_state_events",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	collected := drain(events)
	stateEvents := filterByType(collected, "execution_state_change")
	require.Len(t, stateEvents, 2,
		"execute_flow must emit exactly two workflow-level state events: running → success")

	// First: running. Carries trace_id + started_at — Studio renders the
	// running indicator and stops the 20s timeout from firing.
	first := stateEvents[0]
	firstES, ok := first.Payload["execution_state"].(map[string]any)
	require.True(t, ok, "first event must carry execution_state payload")
	assert.Equal(t, "running", firstES["status"])
	assert.Equal(t, "trace_state_events", firstES["trace_id"])
	require.Contains(t, firstES, "timestamps", "running event must stamp started_at so Studio can compute duration")

	// Second: success. Carries the final result map so Studio's End-node
	// inspector renders the workflow-level output.
	second := stateEvents[1]
	secondES, ok := second.Payload["execution_state"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "success", secondES["status"])
	assert.Equal(t, "trace_state_events", secondES["trace_id"])
	require.Contains(t, secondES, "result")
	ts, ok := secondES["timestamps"].(map[string]any)
	require.True(t, ok)
	assert.Contains(t, ts, "started_at")
	assert.Contains(t, ts, "finished_at")

	// Sanity: Component events still fire in between — the new
	// workflow-level events are additive, not replacing.
	componentEvents := filterByType(collected, "component_state_change")
	assert.NotEmpty(t, componentEvents, "per-node component_state_change events must still emit alongside workflow-level ones")
}

// TestExecuteStream_EmitsErrorWorkflowEventOnNodeFailure pins the
// error path — when a node fails, nlpgo must emit
// execution_state_change{status:"error"} so Studio's reducer flips
// workflow.state.execution.status to "error" and surfaces the message
// via alertOnError(). Pre-fix the workflow stayed "waiting" and only
// the failed node turned red.
func TestExecuteStream_EmitsErrorWorkflowEventOnNodeFailure(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "wf_state_error",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			// code node with no Code executor wired — deterministic failure
			{ID: "code-1", Type: dsl.ComponentCode},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "code-1", TargetHandle: "inputs.input"},
		},
	}

	events, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"input": "boom"},
		TraceID:  "trace_state_error",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	collected := drain(events)
	stateEvents := filterByType(collected, "execution_state_change")
	require.Len(t, stateEvents, 2,
		"error path emits running → error (still 2 workflow-level state events; the run starts and ends)")

	last := stateEvents[len(stateEvents)-1]
	es, ok := last.Payload["execution_state"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "error", es["status"])
	assert.Equal(t, "trace_state_error", es["trace_id"])
	assert.Contains(t, es, "error", "error event must carry the message Studio surfaces in the alertOnError toast")
}

// TestExecuteStream_ExecuteComponentDoesNotEmitWorkflowStateEvents pins
// the polarity: execute_component (req.NodeID set) targets a single
// node and Studio tracks that path via componentExecutionState only —
// emitting a workflow-level state change for a single-node Run would
// confuse the reducer (workflow.state.execution would flip to "running"
// for what the user perceives as a per-component test). Run-with-manual-input
// must NOT touch workflow-level state.
func TestExecuteStream_ExecuteComponentDoesNotEmitWorkflowStateEvents(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "wf_component_only",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "end", TargetHandle: "inputs.output"},
		},
	}

	events, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"input": "hello"},
		NodeID:   "end",
		TraceID:  "trace_component_only",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	collected := drain(events)
	stateEvents := filterByType(collected, "execution_state_change")
	assert.Empty(t, stateEvents,
		"execute_component path must not emit workflow-level execution_state_change — Studio tracks per-component state only")
}

// TestExecuteStream_EvaluationEmitsEvaluationStateEvents pins the eval
// counterpart: when Studio's `useEvaluationExecution` dispatches an
// `execute_evaluation` event, nlpgo must emit `evaluation_state_change`
// events (carrying run_id) — not `execution_state_change` — so the
// reducer flips workflow.state.evaluation.status. Without this the eval
// run hits the same 20s "Timeout starting workflow execution" toast
// even though the dataset rows complete on the wire.
//
// The eval path also iterates the workflow over each dataset entry and
// emits a per-entry progress event so the running state stays "fresh"
// for long evaluations (mirrors Python's EvaluationReporting.evaluate_
// and_report → queue.put_nowait per row).
func TestExecuteStream_EvaluationEmitsEvaluationStateEvents(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "wf_eval",
		APIKey:     "k",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				Outputs: []dsl.Field{{Identifier: "input", Type: dsl.FieldTypeStr}},
				Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
					Records: map[string][]any{"input": {"hello"}},
				}},
			}},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "end", TargetHandle: "inputs.output"},
		},
	}

	events, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow:   wf,
		Inputs:     map[string]any{"input": "hello"},
		TraceID:    "trace_eval",
		Type:       "execute_evaluation",
		RunID:      "run_abc123",
		Origin:     "evaluation",
		EvaluateOn: "full",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	collected := drain(events)

	// No execution_state_change events on the eval path — those flip
	// the wrong reducer slot. evaluation_state_change is the only
	// state-change family Studio's eval reducer reads.
	executionEvents := filterByType(collected, "execution_state_change")
	assert.Empty(t, executionEvents,
		"execute_evaluation must NOT emit execution_state_change — that slot is the workflow-flow reducer, not the evaluation reducer")

	evalEvents := filterByType(collected, "evaluation_state_change")
	require.GreaterOrEqual(t, len(evalEvents), 3,
		"execute_evaluation emits at least running → progress(per row) → success — got %d", len(evalEvents))

	first := evalEvents[0]
	firstES, ok := first.Payload["evaluation_state"].(map[string]any)
	require.True(t, ok, "first eval event must carry evaluation_state payload (matches python EvaluationStateChangePayload shape)")
	assert.Equal(t, "running", firstES["status"])
	assert.Equal(t, "run_abc123", firstES["run_id"],
		"run_id round-trips so Studio's useEvaluationExecution.scheduleTimeout can match the streamed update to the run it dispatched")

	last := evalEvents[len(evalEvents)-1]
	lastES, ok := last.Payload["evaluation_state"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "success", lastES["status"])
	assert.Equal(t, "run_abc123", lastES["run_id"])
	ts, ok := lastES["timestamps"].(map[string]any)
	require.True(t, ok)
	assert.Contains(t, ts, "started_at")
	assert.Contains(t, ts, "finished_at")

	// Middle event must carry the progress/total counters Studio
	// renders the per-row spinner from.
	mid := evalEvents[len(evalEvents)-2]
	midES, ok := mid.Payload["evaluation_state"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "running", midES["status"])
	assert.EqualValues(t, 1, midES["progress"], "progress must be incremented per row")
	assert.EqualValues(t, 1, midES["total"], "total must equal the row count")
}

// TestExecuteStream_EvaluationErrorEmitsEvaluationErrorEvent pins the
// eval-path error contract — when the evaluation can't even start
// (here: entry node has no inline dataset, the error path before
// per-row iteration), Studio's reducer still gets running → error
// with run_id so it can render the alertOnError toast. Per-row engine
// errors do NOT abort the whole eval (Python parity: DSPy Evaluate's
// provide_traceback=True continues past row failures).
func TestExecuteStream_EvaluationErrorEmitsEvaluationErrorEvent(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "wf_eval_error",
		APIKey:     "k",
		Nodes: []dsl.Node{
			// Entry node missing the inline dataset — selectEvaluationEntries
			// rejects this up-front so the eval can't iterate.
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
		TraceID:  "trace_eval_error",
		Type:     "execute_evaluation",
		RunID:    "run_failing",
		Origin:   "evaluation",
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	collected := drain(events)
	evalEvents := filterByType(collected, "evaluation_state_change")
	require.Len(t, evalEvents, 2, "running → error: still 2 eval-state events on the dataset-misconfigured failure path")

	first := evalEvents[0]
	firstES, ok := first.Payload["evaluation_state"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "running", firstES["status"])

	last := evalEvents[len(evalEvents)-1]
	es, ok := last.Payload["evaluation_state"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "error", es["status"])
	assert.Equal(t, "run_failing", es["run_id"])
	assert.Contains(t, es, "error", "error event must carry the message Studio surfaces in the alertOnError toast")
}

func drain(events <-chan StreamEvent) []StreamEvent {
	var out []StreamEvent
	timeout := time.After(5 * time.Second)
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return out
			}
			out = append(out, ev)
		case <-timeout:
			return out
		}
	}
}

func filterByType(events []StreamEvent, t string) []StreamEvent {
	var out []StreamEvent
	for _, e := range events {
		if e.Type == t {
			out = append(out, e)
		}
	}
	return out
}
