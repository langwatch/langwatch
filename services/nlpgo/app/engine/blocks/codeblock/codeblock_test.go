package codeblock_test

import (
	"context"
	"os/exec"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// requirePython skips the test if python3 isn't available.
func requirePython(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed; skipping code-block subprocess tests")
	}
}

func newExec(t *testing.T) *codeblock.Executor {
	t.Helper()
	e, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	return e
}

func TestCodeBlock_HappyPath(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "def execute(a, b):\n    return {'sum': a + b}\n",
		Inputs: map[string]any{
			"a": float64(2),
			"b": float64(3),
		},
		DeclaredOutputs: []string{"sum"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, float64(5), res.Outputs["sum"])
}

func TestCodeBlock_StdoutCaptured(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "def execute():\n    print('hello-stdout')\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error)
	assert.Contains(t, res.Stdout, "hello-stdout")
}

func TestCodeBlock_MissingDeclaredOutput(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'sum': 1}\n",
		DeclaredOutputs: []string{"sum", "diff"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "missing_output: diff")
}

func TestCodeBlock_ExtraOutputDropped(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'sum': 5, 'scratch': [1,2,3]}\n",
		DeclaredOutputs: []string{"sum"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error)
	assert.Equal(t, float64(5), res.Outputs["sum"])
	_, hasScratch := res.Outputs["scratch"]
	assert.False(t, hasScratch, "undeclared outputs should be dropped")
}

func TestCodeBlock_RaisesAreStructured(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "def execute():\n    return {'x': 1/0}\n",
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Equal(t, "ZeroDivisionError", res.Error.Type)
	assert.Contains(t, res.Error.Traceback, "ZeroDivisionError")
}

func TestCodeBlock_SyntaxErrorReported(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "def execute(:",
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Type, "SyntaxError")
}

func TestCodeBlock_TimeoutKillsSubprocess(t *testing.T) {
	requirePython(t)
	start := time.Now()
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:    "def execute():\n    import time\n    time.sleep(10)\n    return {'ok': True}\n",
		Timeout: 500 * time.Millisecond,
	})
	elapsed := time.Since(start)
	require.NoError(t, err)
	assert.True(t, res.TimedOut)
	require.NotNil(t, res.Error)
	assert.Equal(t, "Timeout", res.Error.Type)
	assert.Less(t, elapsed, 3*time.Second, "subprocess must die promptly")
}

func TestCodeBlock_NoExecuteFunctionDefined(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "x = 1\n",
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Equal(t, "NameError", res.Error.Type)
}

func TestCodeBlock_InvocationsAreIsolated(t *testing.T) {
	requirePython(t)
	exec := newExec(t)
	code := "global_count = locals().get('global_count', 0) + 1\n" +
		"def execute():\n    return {'x': global_count}\n"
	for i := 0; i < 3; i++ {
		res, err := exec.Execute(context.Background(), codeblock.Request{
			Code:            code,
			DeclaredOutputs: []string{"x"},
		})
		require.NoError(t, err)
		require.Nil(t, res.Error, "iter %d", i)
		assert.Equal(t, float64(1), res.Outputs["x"], "no global state leak between invocations")
	}
}
