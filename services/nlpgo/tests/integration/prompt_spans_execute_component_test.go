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

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

/** @scenario "PromptApiService.get sibling carries the combined handle:version id" */
func TestPromptSpansExecuteComponent_GetSiblingCarriesCombinedId(t *testing.T) {
	// Real assertion (Lane D, 1/3). Other stubs in this file stay
	// t.Skip — the engine helper is unit-tested at
	// services/nlpgo/app/engine/prompt_spans_emit_test.go; this
	// integration test pins the dispatch boundary calls it correctly.
	body := signatureWorkflowBody(t, signatureNodeOpts{
		ConfigID:      "prompt_4RXLJtB9Cj-OA1BaLpxWc",
		Handle:        "pizza-prompt",
		VersionID:     "prompt_version_I21kDsHKtr5wQm9k1Dap2",
		VersionNumber: 6,
		Instructions:  "You are a helpful assistant.",
	}, map[string]any{"input": "ping"})

	fx, _ := runPromptSpansDispatch(t, body)

	get := fx.FindPromptSpan(t, "PromptApiService.get")
	getAttrs := promptSpanAttrs(get)
	assert.Equal(t, "pizza-prompt:6", getAttrs["langwatch.prompt.id"],
		"PromptApiService.get must carry combined handle:version id (the resume target the trace-UI reads)")

	// Variables envelope must carry the prompt_id input the python
	// decorator records. Decoded shape: {"type":"json","value":{"prompt_id":"..."}}
	rawVars, ok := getAttrs["langwatch.prompt.variables"].(string)
	assert.True(t, ok, "langwatch.prompt.variables must be set as a JSON string")
	assert.Contains(t, rawVars, `"prompt_id":"prompt_4RXLJtB9Cj-OA1BaLpxWc"`,
		"variables envelope must include the prompt_id input")
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
