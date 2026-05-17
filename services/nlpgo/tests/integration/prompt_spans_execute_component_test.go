// Prompt-span emission parity tests for the Studio Run-Component
// surface (execute_component dispatch with origin="workflow").
//
// Pinned by specs/nlp-go/prompt-spans-execute-component.feature. When
// the user clicks Run on a single signature node in Studio, the
// nlpgo engine must emit PromptApiService.get + Prompt.compile as
// siblings of the LLM span under that node's component span, with
// the same 5-attribute identity shape python-sdk emits when a host
// app calls prompt.get() + prompt.compile() directly.
//
// Note: the playground-origin half of execute_component (where
// PromptStudioAdapter dispatches with origin="playground") is
// covered by prompt_spans_playground_test.go; this file pins the
// workflow-origin surface.

package integration_test

import "testing"

/** @scenario "PromptApiService.get sibling carries the combined handle:version id" */
func TestPromptSpansExecuteComponent_GetSiblingCarriesCombinedId(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "Prompt.compile sibling carries the full prompt identity and the substituted variables" */
func TestPromptSpansExecuteComponent_CompileSiblingCarriesFullIdentity(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "spans are siblings of the LLM span, not ancestors" */
func TestPromptSpansExecuteComponent_SpansAreSiblingsOfLLM(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "node without a configId emits no prompt spans" */
func TestPromptSpansExecuteComponent_NoConfigIdMeansNoPromptSpans(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "PromptApiService.get omits handle:version when either is missing" */
func TestPromptSpansExecuteComponent_GetOmitsCombinedIdWhenPartial(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "Prompt.compile variables match the inputs that drove RenderFull" */
func TestPromptSpansExecuteComponent_VariablesMatchRenderFullInputs(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "Variables capture is best-effort — non-JSON-serializable values are stringified, the dispatch still succeeds" */
func TestPromptSpansExecuteComponent_VariablesCaptureIsBestEffort(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario 'Studio Run-Component dispatch propagates origin="workflow" to both prompt spans' */
func TestPromptSpansExecuteComponent_OriginWorkflowPropagatedToBothSpans(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}
