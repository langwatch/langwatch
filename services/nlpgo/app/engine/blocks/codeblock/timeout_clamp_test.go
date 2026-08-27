package codeblock_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// TestCodeBlock_RequestTimeoutCannotExceedTheOperatorCeiling pins that a
// per-request timeout is a way to ask for LESS time than the operator allows,
// never more. Options.DefaultTimeout carries
// NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS — the bound on how long untrusted
// customer code may hold a worker — so a larger number arriving from a
// workflow node must not win.
// @scenario "A per-node code timeout cannot exceed the operator's ceiling"
func TestCodeBlock_RequestTimeoutCannotExceedTheOperatorCeiling(t *testing.T) {
	requirePython(t)
	e, err := codeblock.New(codeblock.Options{DefaultTimeout: 500 * time.Millisecond})
	require.NoError(t, err)

	start := time.Now()
	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    import time\n    time.sleep(10)\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
		Timeout:         30 * time.Second,
	})
	elapsed := time.Since(start)
	require.NoError(t, err)
	assert.True(t, res.TimedOut, "the ceiling, not the request, must decide")
	require.NotNil(t, res.Error)
	assert.Equal(t, codeblock.TimeoutType, res.Error.Type)
	assert.Less(t, elapsed, 3*time.Second, "the run must be stopped at the ceiling")
}

// TestCodeBlock_RequestTimeoutBelowTheCeilingIsHonored pins the other half:
// asking for less than the ceiling still shortens the run.
func TestCodeBlock_RequestTimeoutBelowTheCeilingIsHonored(t *testing.T) {
	requirePython(t)
	e, err := codeblock.New(codeblock.Options{DefaultTimeout: 30 * time.Second})
	require.NoError(t, err)

	start := time.Now()
	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    import time\n    time.sleep(10)\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
		Timeout:         500 * time.Millisecond,
	})
	elapsed := time.Since(start)
	require.NoError(t, err)
	assert.True(t, res.TimedOut)
	assert.Less(t, elapsed, 3*time.Second)
}

// TestCodeBlock_NegativeRequestTimeoutFallsBackToTheDefault pins that a
// negative duration never reaches context.WithTimeout, where it would expire
// the context before the subprocess starts and report a timeout for code that
// was never given a chance to run.
// @scenario "A negative per-node code timeout falls back to the default"
func TestCodeBlock_NegativeRequestTimeoutFallsBackToTheDefault(t *testing.T) {
	requirePython(t)
	e, err := codeblock.New(codeblock.Options{DefaultTimeout: 30 * time.Second})
	require.NoError(t, err)

	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'ok': 'done'}\n",
		DeclaredOutputs: []string{"ok"},
		Timeout:         -1 * time.Second,
	})
	require.NoError(t, err)
	assert.False(t, res.TimedOut, "a negative timeout is not a zero budget")
	require.Nil(t, res.Error)
	assert.Equal(t, "done", res.Outputs["ok"])
}
