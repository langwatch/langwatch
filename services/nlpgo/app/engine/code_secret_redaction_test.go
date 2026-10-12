package engine

import (
	"context"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// Code nodes get project secrets as a live `secrets.NAME` namespace, so a
// raised exception can carry a secret's plaintext in its message or traceback
// — the same hazard runHTTP already defends against, because Go's HTTP errors
// embed the request URL (engine.go, runHTTP). runCode and runIfElsePython take
// `secrets` and did not redact, which only stayed harmless while the scenario
// adapter discarded engine errors entirely. #3198 makes those messages
// customer-visible (they are re-thrown by SerializedWorkflowAgentAdapter and
// persisted onto the run record), so the gap has to close in the same change.

func requirePythonRunner(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not on PATH")
	}
}

const secretValue = "sk-live-DO-NOT-LEAK-8f21c"

// @scenario "A code node that raises with a secret in the message does not leak it"
func TestRunCode_RedactsSecretValueFromErrorMessage(t *testing.T) {
	requirePythonRunner(t)
	eng := newCodeEngine(t)

	// The realistic shape: user code interpolates a secret into a request and
	// the failure carries it. Raising directly is the same leak, minus the network.
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code", Type: dsl.ComponentCode, Data: dsl.Component{
				Outputs:    []dsl.Field{{Identifier: "out", Type: "str"}},
				Parameters: []dsl.Field{codeParam("def execute():\n    raise RuntimeError('GET https://api.example.com?key=' + secrets.API_KEY + ' failed')\n")},
			}},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges:   []dsl.Edge{{ID: "e1", Source: "entry", Target: "code"}, {ID: "e2", Source: "code", Target: "end"}},
		Secrets: map[string]string{"API_KEY": secretValue},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{Workflow: w, TraceID: "t"})
	require.NoError(t, err)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)

	assert.NotContains(t, res.Error.Message, secretValue,
		"the secret's plaintext must not survive into the error message the adapter re-throws")
	assert.NotContains(t, res.Error.Traceback, secretValue,
		"the traceback is surfaced alongside the message and must be redacted too")
	assert.Contains(t, res.Error.Message, "[redacted]",
		"redaction must be visible, not silent truncation")
}

// @scenario "An if/else condition node that raises with a secret does not leak it"
func TestRunIfElsePython_RedactsSecretValueFromErrorMessage(t *testing.T) {
	requirePythonRunner(t)
	eng := newCodeEngine(t)

	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "gate", Type: dsl.ComponentIfElse, Data: dsl.Component{
				Outputs: []dsl.Field{{Identifier: "true", Type: "bool"}, {Identifier: "false", Type: "bool"}},
				Parameters: []dsl.Field{
					strParam("condition_language", "python"),
					codeParam("def execute():\n    raise RuntimeError('token=' + secrets.API_KEY)\n"),
				},
			}},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges:   []dsl.Edge{{ID: "e1", Source: "entry", Target: "gate"}, {ID: "e2", Source: "gate", SourceHandle: "outputs.true", Target: "end"}},
		Secrets: map[string]string{"API_KEY": secretValue},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{Workflow: w, TraceID: "t"})
	require.NoError(t, err)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)

	assert.NotContains(t, res.Error.Message, secretValue)
	assert.NotContains(t, res.Error.Traceback, secretValue)
	// The same two anti-vacuity checks its runCode sibling carries: without
	// them this pair would go green the moment the if/else path stopped
	// reporting an error message at all.
	assert.Contains(t, res.Error.Message, "[redacted]",
		"redaction must be visible, not silent truncation")
	assert.Contains(t, res.Error.Message, "token=",
		"the non-secret part must survive — otherwise NotContains proves nothing")
}

// Redacting only Message and Traceback leaves the secret a sibling field to
// escape through. NodeState.Stdout/.Stderr are captured verbatim from the
// runner and ride in the SAME response — `result.nodes` (their own doc says
// so, and cmd/engine_adapter.go copies the map through) plus every
// execution_state_change SSE frame. Two live paths: user code that prints a
// secret, and the runner's last-ditch dump of the whole payload — traceback
// included — to stderr when it cannot write its result file.
//
// @scenario "A code node that prints a secret does not leak it through stdout"
func TestRunCode_RedactsSecretValueFromStdout(t *testing.T) {
	requirePythonRunner(t)
	eng := newCodeEngine(t)

	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code", Type: dsl.ComponentCode, Data: dsl.Component{
				Outputs:    []dsl.Field{{Identifier: "out", Type: "str"}},
				Parameters: []dsl.Field{codeParam("import sys\ndef execute():\n    print('using key ' + secrets.API_KEY)\n    print('to stderr ' + secrets.API_KEY, file=sys.stderr)\n    return {'out': 'done'}\n")},
			}},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges:   []dsl.Edge{{ID: "e1", Source: "entry", Target: "code"}, {ID: "e2", Source: "code", Target: "end"}},
		Secrets: map[string]string{"API_KEY": secretValue},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{Workflow: w, TraceID: "t"})
	require.NoError(t, err)
	require.Equal(t, "success", res.Status, "the node itself succeeds — this is about what rides along with it")

	code := res.Nodes["code"]
	require.NotNil(t, code)
	assert.NotContains(t, code.Stdout, secretValue,
		"stdout ships in result.nodes and in every execution_state_change frame")
	assert.NotContains(t, code.Stderr, secretValue, "same for stderr")
	// Control: the surrounding output must survive, or the assertions above
	// would pass on an empty capture.
	assert.Contains(t, code.Stdout, "using key", "non-secret stdout must still be captured")
	assert.Contains(t, code.Stderr, "to stderr", "non-secret stderr must still be captured")
}

// The falsifiability control for both tests above: an absence assertion goes
// vacuous the moment the code path stops running at all (a skipped node, a
// planner rejection, an empty message). This pins that the unredacted engine
// really does emit the surrounding text, so `NotContains` is testing redaction
// rather than silence.
func TestRunCode_ErrorMessageStillCarriesTheSurroundingContext(t *testing.T) {
	requirePythonRunner(t)
	eng := newCodeEngine(t)

	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code", Type: dsl.ComponentCode, Data: dsl.Component{
				Outputs:    []dsl.Field{{Identifier: "out", Type: "str"}},
				Parameters: []dsl.Field{codeParam("def execute():\n    raise RuntimeError('GET https://api.example.com?key=' + secrets.API_KEY + ' failed')\n")},
			}},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges:   []dsl.Edge{{ID: "e1", Source: "entry", Target: "code"}, {ID: "e2", Source: "code", Target: "end"}},
		Secrets: map[string]string{"API_KEY": secretValue},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{Workflow: w, TraceID: "t"})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "api.example.com",
		"the non-secret part of the message must survive — otherwise NotContains proves nothing")
}

// The tests above all need python3 and therefore all carry a t.Skip. A
// security property whose ONLY assertions can silently skip is a property
// nothing defends on a machine without the interpreter. redactNodeSecrets is a
// pure function, so the invariant itself can be pinned unconditionally — the
// python-backed tests stay as the end-to-end proof that the real runner's
// output actually flows through it.
func TestRedactNodeSecrets_ScrubsEveryStringItOwns(t *testing.T) {
	ns := &NodeState{
		Stdout: "printed " + secretValue,
		Stderr: "logged " + secretValue,
	}
	derr := &NodeError{
		Message:   "failed with " + secretValue,
		Traceback: "line 1: " + secretValue,
	}

	redactNodeSecrets(ns, derr, map[string]string{"API_KEY": secretValue})

	assert.Equal(t, "printed [redacted]", ns.Stdout)
	assert.Equal(t, "logged [redacted]", ns.Stderr)
	assert.Equal(t, "failed with [redacted]", derr.Message)
	assert.Equal(t, "line 1: [redacted]", derr.Traceback)
}

// The nil and empty cases the choke point sees on every non-erroring node.
func TestRedactNodeSecrets_TolerantOfNilAndEmpty(t *testing.T) {
	assert.NotPanics(t, func() {
		redactNodeSecrets(nil, nil, map[string]string{"K": secretValue})
		redactNodeSecrets(&NodeState{}, nil, nil)
		redactNodeSecrets(nil, &NodeError{Message: "x"}, map[string]string{})
	})
}
