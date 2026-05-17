// Prompt-span emission parity tests for the execute_flow (full
// workflow run) surface.
//
// Pinned by specs/nlp-go/prompt-spans-execute-workflow.feature. When
// a workflow with multiple signature nodes runs via execute_flow,
// each signature node's LLM span must have its own
// PromptApiService.get + Prompt.compile siblings — bound to that
// node's configId/versionId, that node's resolved variables, and
// emitted under that node's per-component span. Without per-node
// scoping the trace-UI ancestor walk leaks one node's prompt
// identity into another node's drawer.

package integration_test

import "testing"

/** @scenario "two signature nodes in series emit two distinct sibling pairs" */
func TestPromptSpansExecuteWorkflow_TwoNodesEmitTwoDistinctPairs(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "variables capture reflects each node's resolved inputs, not the workflow's" */
func TestPromptSpansExecuteWorkflow_VariablesScopedPerNode(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "signature node with no configId coexists with a prompted node" */
func TestPromptSpansExecuteWorkflow_MixedPromptedAndUnpromptedNodes(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "prompt spans live under the per-node span so the ancestor scan stays scoped" */
func TestPromptSpansExecuteWorkflow_PromptSpansUnderPerNodeParent(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "origin propagation matches the dispatch endpoint" */
func TestPromptSpansExecuteWorkflow_OriginPropagatedToBothSpans(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "a node dispatched twice in one run emits two prompt-span pairs" */
func TestPromptSpansExecuteWorkflow_LoopedNodeEmitsTwoPairs(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}
