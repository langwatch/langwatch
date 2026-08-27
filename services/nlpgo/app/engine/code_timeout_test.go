package engine

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// withTimeoutMS adds a `timeout_ms` parameter to a code node, the same
// identifier, type and units the HTTP block already reads.
func withTimeoutMS(node *dsl.Node, ms int) *dsl.Node {
	value, _ := json.Marshal(ms)
	node.Data.Parameters = append(node.Data.Parameters, dsl.Field{
		Identifier: "timeout_ms",
		Type:       dsl.FieldTypeInt,
		Value:      value,
	})
	return node
}

const sleepTenSeconds = "def execute():\n    import time\n    time.sleep(10)\n    return {'ok': 'done'}\n"

// TestRunCode_HonorsTheNodeTimeout pins that a code node declaring
// `timeout_ms` is stopped at that budget instead of running to the executor
// default — the same per-node knob the HTTP block already offers.
// @scenario "A code node's timeout_ms shortens its budget"
func TestRunCode_HonorsTheNodeTimeout(t *testing.T) {
	requirePythonForRedaction(t)
	codeExec, err := codeblock.New(codeblock.Options{DefaultTimeout: 30 * time.Second})
	require.NoError(t, err)
	eng := New(Options{Code: codeExec})

	node := withTimeoutMS(codeNode("code-1", sleepTenSeconds, "ok"), 500)
	start := time.Now()
	_, nodeErr := eng.runCode(context.Background(), node, nodeRun{ns: &NodeState{ID: "code-1"}})
	elapsed := time.Since(start)

	require.NotNil(t, nodeErr, "the node must be stopped at its declared budget")
	assert.Equal(t, "code_block_timeout", nodeErr.Type)
	assert.Less(t, elapsed, 3*time.Second)
}

// TestRunCode_NodeTimeoutCannotExceedTheOperatorCeiling pins the security
// property end to end: a workflow author writing a number larger than
// NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS does not buy their code more time.
// @scenario "A code node cannot raise its own timeout above the operator ceiling"
func TestRunCode_NodeTimeoutCannotExceedTheOperatorCeiling(t *testing.T) {
	requirePythonForRedaction(t)
	codeExec, err := codeblock.New(codeblock.Options{DefaultTimeout: 500 * time.Millisecond})
	require.NoError(t, err)
	eng := New(Options{Code: codeExec})

	node := withTimeoutMS(codeNode("code-1", sleepTenSeconds, "ok"), 30_000)
	start := time.Now()
	_, nodeErr := eng.runCode(context.Background(), node, nodeRun{ns: &NodeState{ID: "code-1"}})
	elapsed := time.Since(start)

	require.NotNil(t, nodeErr)
	assert.Equal(t, "code_block_timeout", nodeErr.Type)
	assert.Less(t, elapsed, 3*time.Second, "the ceiling still bounds the run")
}

// TestRunCode_NonPositiveNodeTimeoutFallsBackToTheDefault pins that a missing,
// zero or negative `timeout_ms` leaves the executor default in charge, and in
// particular that a negative value never becomes a zero budget.
// @scenario "A missing or negative code timeout_ms falls back to the default"
func TestRunCode_NonPositiveNodeTimeoutFallsBackToTheDefault(t *testing.T) {
	requirePythonForRedaction(t)
	codeExec, err := codeblock.New(codeblock.Options{DefaultTimeout: 30 * time.Second})
	require.NoError(t, err)
	eng := New(Options{Code: codeExec})

	quick := "def execute():\n    return {'ok': 'done'}\n"
	for name, node := range map[string]*dsl.Node{
		"missing":  codeNode("code-1", quick, "ok"),
		"zero":     withTimeoutMS(codeNode("code-1", quick, "ok"), 0),
		"negative": withTimeoutMS(codeNode("code-1", quick, "ok"), -5000),
	} {
		t.Run(name, func(t *testing.T) {
			outputs, nodeErr := eng.runCode(context.Background(), node, nodeRun{ns: &NodeState{ID: "code-1"}})
			require.Nil(t, nodeErr, "expected the node to succeed, got %+v", nodeErr)
			assert.Equal(t, "done", outputs["ok"])
		})
	}
}
