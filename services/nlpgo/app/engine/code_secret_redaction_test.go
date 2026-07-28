package engine

import (
	"context"
	"encoding/json"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
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

// codeParam / strParam build the `paramString`-readable DSL fields these
// nodes are configured through (values are JSON-encoded on the wire).
func codeParam(src string) dsl.Field { return strParam("code", src) }

func strParam(name, value string) dsl.Field {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return dsl.Field{Identifier: name, Type: "str", Value: raw}
}

func newCodeEngine(t *testing.T) *Engine {
	t.Helper()
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	return New(Options{Code: codeExec})
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
