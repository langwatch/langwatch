package engine

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// sessionEchoCode answers with the declared `output` and, beside it, a
// `session` the workflow never declares. It reads the session it was given
// as a dict, or nothing on the first turn.
const sessionEchoCode = "def execute(input, session):\n" +
	"    turn = (session or {}).get('turn', 0) + 1\n" +
	"    return {'output': f'{input}:{turn}', 'session': {'turn': turn}}\n"

// sessionEchoWorkflow wires entry -> code -> end the way the platform's code
// agent adapter does: the entry carries `input` and `session`, the code node
// declares `output` and only `output` reaches the end node.
func sessionEchoWorkflow() *dsl.Workflow {
	code := codeNode("code_agent", sessionEchoCode, "output")
	code.Data.Inputs = []dsl.Field{
		{Identifier: "input", Type: dsl.FieldTypeStr},
		{Identifier: "session", Type: dsl.FieldTypeDict},
	}
	return &dsl.Workflow{
		WorkflowID: "wf_session_echo",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			*code,
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "code_agent", TargetHandle: "inputs.input"},
			{Source: "entry", SourceHandle: "outputs.session", Target: "code_agent", TargetHandle: "inputs.session"},
			{Source: "code_agent", SourceHandle: "outputs.output", Target: "end", TargetHandle: "inputs.output"},
		},
	}
}

// TestExecute_CodeSessionReachesTheNodeStateUntouched pins the contract the
// code agent adapter reads the session by: a key the code returns beside its
// declared output lands in the node's own state, with the JSON value the code
// produced, and a non-string entry input reaches the code as that value. The
// end node result stays what the workflow declared.
// @scenario "The session a code node returns beside its declared output reaches the run"
func TestExecute_CodeSessionReachesTheNodeStateUntouched(t *testing.T) {
	requirePythonForRedaction(t)
	codeExec, err := codeblock.New(codeblock.Options{DefaultTimeout: 30 * time.Second})
	require.NoError(t, err)
	eng := New(Options{Code: codeExec})

	first, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: sessionEchoWorkflow(),
		Inputs:   map[string]any{"input": "hi", "session": nil},
		TraceID:  "trace_session_first",
	})
	require.NoError(t, err)
	require.Equal(t, "success", first.Status, "first turn: %+v", first.Error)
	assert.Equal(t, map[string]any{"output": "hi:1"}, first.Result)
	require.Contains(t, first.Nodes, "code_agent")
	assert.Equal(t, map[string]any{"turn": float64(1)}, first.Nodes["code_agent"].Outputs["session"])

	second, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: sessionEchoWorkflow(),
		Inputs:   map[string]any{"input": "again", "session": map[string]any{"turn": float64(1)}},
		TraceID:  "trace_session_second",
	})
	require.NoError(t, err)
	require.Equal(t, "success", second.Status, "second turn: %+v", second.Error)
	assert.Equal(t, map[string]any{"output": "again:2"}, second.Result)
	assert.Equal(t, map[string]any{"turn": float64(2)}, second.Nodes["code_agent"].Outputs["session"])
}
