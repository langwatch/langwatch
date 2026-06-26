package integration_test

// Spec-bound code-block tests. Each test carries a `@scenario` annotation
// tying it to a scenario in specs/nlp-go/code-block.feature so the
// feature-parity checker (langwatch/scripts/check-feature-parity.ts, Go
// walker) can bind it. These cover the deterministic execution-semantics
// scenarios that run fully through /go/studio/execute_sync: declared I/O,
// missing/extra outputs, the secrets namespace, surfaced exceptions with
// tracebacks, and per-invocation process isolation.

import (
	"encoding/json"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// codeWorkflow assembles a single-code-node Studio workflow: an entry node
// feeds the declared inputs from inline dataset records, the code node runs
// `code`, and an end node mirrors the declared outputs. Built as a map and
// marshalled so user code and values are escaped correctly.
func codeWorkflow(traceID, nodeID, code string, inputs map[string]any, inputType map[string]string, outputs []string, secrets map[string]string) string {
	records := map[string]any{}
	entryOutputs := []any{}
	codeInputs := []any{}
	entryToCodeEdges := []any{}
	for name, val := range inputs {
		typ := inputType[name]
		if typ == "" {
			typ = "str"
		}
		records[name] = []any{val}
		entryOutputs = append(entryOutputs, map[string]any{"identifier": name, "type": typ})
		codeInputs = append(codeInputs, map[string]any{"identifier": name, "type": typ})
		entryToCodeEdges = append(entryToCodeEdges, map[string]any{
			"id": "in_" + name, "source": "entry", "sourceHandle": "outputs." + name,
			"target": nodeID, "targetHandle": "inputs." + name, "type": "default",
		})
	}
	// Entry needs at least one output column to drive a dataset row.
	if len(entryOutputs) == 0 {
		records["_seed"] = []any{"x"}
		entryOutputs = append(entryOutputs, map[string]any{"identifier": "_seed", "type": "str"})
	}

	codeOutputs := []any{}
	endInputs := []any{}
	codeToEndEdges := []any{}
	for _, o := range outputs {
		codeOutputs = append(codeOutputs, map[string]any{"identifier": o, "type": "str"})
		endInputs = append(endInputs, map[string]any{"identifier": o, "type": "str"})
		codeToEndEdges = append(codeToEndEdges, map[string]any{
			"id": "out_" + o, "source": nodeID, "sourceHandle": "outputs." + o,
			"target": "end", "targetHandle": "inputs." + o, "type": "default",
		})
	}

	wf := map[string]any{
		"workflow_id": "wf", "api_key": "k", "spec_version": "1.3", "name": "x",
		"icon": "x", "description": "x", "version": "x", "template_adapter": "default",
		"nodes": []any{
			map[string]any{"id": "entry", "type": "entry", "data": map[string]any{
				"outputs":         entryOutputs,
				"dataset":         map[string]any{"inline": map[string]any{"records": records}},
				"entry_selection": 0, "train_size": 1.0, "test_size": 0.0, "seed": 1,
			}},
			map[string]any{"id": nodeID, "type": "code", "data": map[string]any{
				"parameters": []any{map[string]any{"identifier": "code", "type": "code", "value": code}},
				"inputs":     codeInputs,
				"outputs":    codeOutputs,
			}},
			map[string]any{"id": "end", "type": "end", "data": map[string]any{"inputs": endInputs}},
		},
		"edges": append(entryToCodeEdges, codeToEndEdges...),
		"state": map[string]any{},
	}
	if len(secrets) > 0 {
		wf["secrets"] = secrets
	}

	body := map[string]any{
		"type": "execute_flow",
		"payload": map[string]any{
			"trace_id": traceID,
			"workflow": wf,
			"inputs":   []any{map[string]any{}},
			"origin":   "workflow",
		},
	}
	out, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return string(out)
}

func requirePython(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed")
	}
}

/** @scenario "a code block with two inputs and one output runs and returns the output" */
func TestSync_CodeBlock_TwoInputsOneOutput(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	code := "def execute(a: int, b: int) -> dict:\n    return {\"sum\": a + b}\n"
	body := codeWorkflow("two-in-one-out", "sum", code,
		map[string]any{"a": 2, "b": 3}, map[string]string{"a": "int", "b": "int"},
		[]string{"sum"}, nil)

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.EqualValues(t, 5, res.Result["sum"])
}

/** @scenario "a missing declared output is reported as an error" */
func TestSync_CodeBlock_MissingDeclaredOutput(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	code := "def execute(a):\n    return {\"sum\": 5}\n"
	body := codeWorkflow("missing-output", "sum", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"sum", "diff"}, nil)

	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "missing_output: diff")
}

/** @scenario "an extra undeclared output is dropped silently" */
func TestSync_CodeBlock_ExtraUndeclaredOutputDropped(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	code := "def execute(a):\n    return {\"sum\": 5, \"scratch\": [1, 2, 3]}\n"
	body := codeWorkflow("extra-output", "sum", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"sum"}, nil)

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.EqualValues(t, 5, res.Result["sum"])
	_, hasScratch := res.Result["scratch"]
	assert.False(t, hasScratch, "undeclared output 'scratch' should not flow downstream, got %+v", res.Result)
}

/** @scenario "referencing an undefined secret raises AttributeError, not NameError" */
func TestSync_CodeBlock_UndefinedSecretIsAttributeError(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	code := "def execute(a):\n    return {\"x\": secrets.ABSENT}\n"
	body := codeWorkflow("undefined-secret", "useSecret", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"x"}, map[string]string{"PRESENT": "yes"})

	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "AttributeError", res.Error.Type)
	assert.Contains(t, res.Error.Message, "ABSENT")
}

/** @scenario "with no project secrets the `secrets` name is left undefined (Python parity)" */
func TestSync_CodeBlock_NoSecretsLeavesNameUndefined(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	code := "def execute(a):\n    return {\"x\": secrets.ANYTHING}\n"
	body := codeWorkflow("no-secrets", "useSecret", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"x"}, nil)

	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "secrets")
}

/** @scenario "a SyntaxError in user code is surfaced before any input is sent" */
func TestSync_CodeBlock_SyntaxErrorSurfaced(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	// Invalid syntax: the def is malformed, so compile() fails.
	code := "def execute(:\n    return {}\n"
	body := codeWorkflow("syntax-error", "broken", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"x"}, nil)

	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	// The SyntaxError identity is surfaced on the error type; the message
	// carries Python's "invalid syntax" detail. compile() fails before the
	// entrypoint runs, so this is raised before any input is marshalled in.
	assert.Equal(t, "SyntaxError", res.Error.Type)
	assert.Contains(t, res.Error.Message, "invalid syntax")
}

/** @scenario "ZeroDivisionError aborts the node and the workflow with the traceback intact" */
func TestSync_CodeBlock_ZeroDivisionErrorWithTraceback(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	code := "def execute(a):\n    return {\"x\": 1 / 0}\n"
	body := codeWorkflow("zero-div", "divide", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"x"}, nil)

	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "divide", res.Error.NodeID, "error must name the offending code node")
	assert.Equal(t, "ZeroDivisionError", res.Error.Type)
	assert.Contains(t, res.Error.Message, "division by zero")
	// The full "ZeroDivisionError: division by zero" identity and the
	// offending user-code frame are preserved in the traceback. User code
	// is compiled from a string ("<code-block>"), so the frame carries the
	// location (line + the execute entrypoint) rather than echoing source.
	assert.Contains(t, res.Error.Traceback, "ZeroDivisionError: division by zero")
	assert.Contains(t, res.Error.Traceback, "in execute")
}

/** @scenario "state set in one invocation does not leak to the next" */
func TestSync_CodeBlock_NoStateLeakAcrossInvocations(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	// A module-level counter incremented on each call. A fresh subprocess
	// per invocation means it always starts at 0 and returns 1.
	code := "x = 0\n\ndef execute(a):\n    global x\n    x += 1\n    return {\"x\": x}\n"
	body := codeWorkflow("state-leak", "counter", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"x"}, nil)

	for i := 0; i < 5; i++ {
		res := postSync(t, stack, body)
		require.Equal(t, "success", res.Status, "engine error on invocation %d: %+v", i, res.Error)
		assert.EqualValues(t, 1, res.Result["x"], "invocation %d must not see leaked state", i)
	}
}

/** @scenario "the bundled Python interpreter exposes the standard library" */
func TestSync_CodeBlock_StdlibAvailable(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	code := "import json, math, datetime, re, hashlib, base64, urllib\n\n" +
		"def execute(a):\n    return {\"ok\": \"yes\"}\n"
	body := codeWorkflow("stdlib", "imports", code,
		map[string]any{"a": 1}, map[string]string{"a": "int"},
		[]string{"ok"}, nil)

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "yes", res.Result["ok"])
}
