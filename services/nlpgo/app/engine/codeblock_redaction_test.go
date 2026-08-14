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

// requirePythonForRedaction skips when python3 is unavailable: these tests run
// the real sandbox subprocess, because what the interpreter actually writes to
// stdout and stderr is the thing under test.
func requirePythonForRedaction(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed; skipping code-block subprocess tests")
	}
}

// codeNode builds a single code node carrying `code` and declaring `outputs`.
func codeNode(id, code string, outputs ...string) *dsl.Node {
	value, _ := json.Marshal(code)
	declared := make([]dsl.Field, 0, len(outputs))
	for _, name := range outputs {
		declared = append(declared, dsl.Field{Identifier: name, Type: dsl.FieldTypeStr})
	}
	return &dsl.Node{
		ID:   id,
		Type: dsl.ComponentCode,
		Data: dsl.Component{
			Parameters: []dsl.Field{{Identifier: "code", Type: dsl.FieldTypeCode, Value: value}},
			Outputs:    declared,
		},
	}
}

// TestRunCode_ScrubsSecretsFromStoredOutput pins that a secret value the user's
// code prints is scrubbed before it lands on the node state. Stored stdout and
// stderr ride along on execution events, traces and logs exactly as node errors
// do, so a printed credential leaks just as widely as one echoed in an error
// message, which the HTTP path already scrubs.
//
// Run parameters are not credentials, so they survive verbatim: printing one is
// how an author sees what a run was actually given.
// @scenario "Secret values are scrubbed from stored code node stdout and stderr"
func TestRunCode_ScrubsSecretsFromStoredOutput(t *testing.T) {
	requirePythonForRedaction(t)
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	eng := New(Options{Code: codeExec})

	code := "import sys\n" +
		"\n" +
		"def execute():\n" +
		"    print('calling with token ' + secrets.API_TOKEN)\n" +
		"    print('region is ' + params.REGION)\n" +
		"    print('signing with ' + secrets.SIGNING_KEY, file=sys.stderr)\n" +
		"    return {'ok': 'done'}\n"

	ns := &NodeState{ID: "code-1"}
	outputs, nodeErr := eng.runCode(context.Background(), codeNode("code-1", code, "ok"), nodeRun{
		ns: ns,
		secrets: map[string]string{
			"API_TOKEN":   "sk-live-abc123",
			"SIGNING_KEY": "hunter2-signing",
		},
		params: map[string]any{"REGION": "eu-central"},
	})
	require.Nil(t, nodeErr, "expected the node to succeed, got %+v", nodeErr)
	assert.Equal(t, "done", outputs["ok"])

	assert.NotContains(t, ns.Stdout, "sk-live-abc123", "a printed secret must not be stored verbatim")
	assert.Contains(t, ns.Stdout, "calling with token [redacted]")
	assert.NotContains(t, ns.Stderr, "hunter2-signing", "stderr is stored on the same route as stdout")
	assert.Contains(t, ns.Stderr, "signing with [redacted]")

	// Parameters are configuration, not credentials. Scrubbing them would
	// leave an author unable to see what the run was given.
	assert.Contains(t, ns.Stdout, "region is eu-central")
}

// TestRunIfElsePython_ScrubsSecretsFromStoredOutput pins the same rule on the
// other sandbox-backed node: a python condition prints through the identical
// runner, so its stored output is exposed identically.
func TestRunIfElsePython_ScrubsSecretsFromStoredOutput(t *testing.T) {
	requirePythonForRedaction(t)
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	eng := New(Options{Code: codeExec})

	code := "import sys\n" +
		"\n" +
		"def execute():\n" +
		"    print('checking ' + secrets.API_TOKEN)\n" +
		"    print('against ' + secrets.API_TOKEN, file=sys.stderr)\n" +
		"    return True\n"
	conditionValue, _ := json.Marshal(code)
	languageValue, _ := json.Marshal("python")

	node := &dsl.Node{
		ID:   "ifelse-1",
		Type: dsl.ComponentIfElse,
		Data: dsl.Component{
			Parameters: []dsl.Field{
				{Identifier: "condition_language", Type: dsl.FieldTypeStr, Value: languageValue},
				{Identifier: "code", Type: dsl.FieldTypeCode, Value: conditionValue},
			},
		},
	}

	ns := &NodeState{ID: "ifelse-1"}
	outputs, nodeErr := eng.runIfElse(context.Background(), node, nodeRun{
		ns:      ns,
		secrets: map[string]string{"API_TOKEN": "sk-live-abc123"},
	})
	require.Nil(t, nodeErr, "expected the condition to succeed, got %+v", nodeErr)
	assert.Equal(t, true, outputs["true"])

	assert.NotContains(t, ns.Stdout, "sk-live-abc123")
	assert.Contains(t, ns.Stdout, "checking [redacted]")
	assert.NotContains(t, ns.Stderr, "sk-live-abc123")
	assert.Contains(t, ns.Stderr, "against [redacted]")
}
