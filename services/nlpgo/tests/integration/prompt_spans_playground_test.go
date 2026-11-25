// Prompt-span emission parity tests for the playground surface, pinned by
// specs/nlp-go/prompt-spans-playground.feature. An HTTP dispatch with
// origin="playground" must emit PromptApiService.get + Prompt.compile spans
// matching python-sdk's prompt tracing decorators. The engine emission is
// unit-tested in services/nlpgo/app/engine/prompt_spans_emit_test.go.

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// promptSpansPendingMsg: the engine emission is covered by the unit tests in
// app/engine/prompt_spans_emit_test.go; only this HTTP-level test is unwritten.
const promptSpansPendingMsg = "not yet asserted over HTTP; engine emission is covered by app/engine/prompt_spans_emit_test.go"

// promptSpansHeldMsg marks scenarios whose expected outcome awaits a ruling.
const promptSpansHeldMsg = "held: expected outcome awaits a ruling; do not enable until it lands"

// dispatchSavedPlaygroundPrompt sends a playground request for saved prompt
// version pizza-prompt:6 through the engine and returns the recorded spans.
func dispatchSavedPlaygroundPrompt(t *testing.T) *promptSpansFixture {
	t.Helper()
	body := signatureWorkflowBody(t, signatureNodeOpts{
		ConfigID:      "prompt_4RXLJtB9Cj-OA1BaLpxWc",
		Handle:        "pizza-prompt",
		VersionID:     "prompt_version_I21kDsHKtr5wQm9k1Dap2",
		VersionNumber: 6,
		Instructions:  "You are a helpful assistant.",
		TemplateMsgs:  []map[string]any{{"role": "user", "content": "{{input}}"}},
	}, map[string]any{"input": "I want a refund"})
	fx, _ := runPromptSpansDispatch(t, body)
	return fx
}

/** @scenario "playground send on a saved prompt version emits a get+compile span pair" */
func TestPromptSpansPlayground_SavedVersionEmitsGetCompilePair(t *testing.T) {
	fx := dispatchSavedPlaygroundPrompt(t)

	get := fx.FindPromptSpan(t, "PromptApiService.get")
	getAttrs := promptSpanAttrs(get)
	assert.Equal(t, "pizza-prompt:6", getAttrs["langwatch.prompt.id"],
		"PromptApiService.get must carry combined handle:version id when both resolved")

	compile := fx.FindPromptSpan(t, "Prompt.compile")
	compileAttrs := promptSpanAttrs(compile)
	assert.Equal(t, "prompt_4RXLJtB9Cj-OA1BaLpxWc", compileAttrs["langwatch.prompt.id"])
	assert.Equal(t, "pizza-prompt", compileAttrs["langwatch.prompt.handle"])
	assert.Equal(t, "prompt_version_I21kDsHKtr5wQm9k1Dap2", compileAttrs["langwatch.prompt.version.id"])
	assert.Equal(t, int64(6), compileAttrs["langwatch.prompt.version.number"])
	_, hasDraft := compileAttrs["langwatch.prompt.draft"]
	assert.False(t, hasDraft, "saved-version dispatch must NOT emit draft attribute (omission, not false)")

	// Sibling-hierarchy invariant: get + compile share the parent of
	// the LLM span (named after the model — "openai/gpt-5-mini" with
	// our fake client). The engine emits get/compile from the
	// per-node component span context, so their ParentSpanID matches
	// the LLM span's ParentSpanID.
	llm := findLLMSpan(fx.Spans())
	require.NotNil(t, llm, "expected an LLM-typed span; fake LLM should produce one")
	assert.Equal(t, llm.Parent().SpanID(), get.Parent().SpanID(),
		"PromptApiService.get must be a sibling of the LLM span (shared parent)")
	assert.Equal(t, llm.Parent().SpanID(), compile.Parent().SpanID(),
		"Prompt.compile must be a sibling of the LLM span (shared parent)")
}

/** @scenario "playground send on an unsaved fresh prompt emits compile but no get" */
func TestPromptSpansPlayground_FreshAdhocEmitsCompileOnly(t *testing.T) {
	t.Skip(promptSpansHeldMsg)
}

/** @scenario "every declared variable on the prompt is captured on the compile span" */
func TestPromptSpansPlayground_DeclaredVariablesCapturedOnCompile(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "error during compile records the exception on the compile span" */
func TestPromptSpansPlayground_CompileErrorRecordedOnSpan(t *testing.T) {
	t.Skip(promptSpansHeldMsg)
}

/** @scenario "span hierarchy matches python-sdk shape (get + compile + llm are siblings)" */
func TestPromptSpansPlayground_GetCompileLLMSiblingsUnderSameParent(t *testing.T) {
	fx := dispatchSavedPlaygroundPrompt(t)

	get := fx.FindPromptSpan(t, "PromptApiService.get")
	compile := fx.FindPromptSpan(t, "Prompt.compile")
	llm := findLLMSpan(fx.Spans())
	require.NotNil(t, llm, "expected an LLM-typed span; fake LLM should produce one")

	parent := llm.Parent().SpanID()
	require.True(t, parent.IsValid(), "the LLM span must have a parent, not be an orphan root")
	assert.Equal(t, parent, get.Parent().SpanID(), "get must share the LLM span's parent")
	assert.Equal(t, parent, compile.Parent().SpanID(), "compile must share the LLM span's parent, not nest under get")

	traceID := llm.SpanContext().TraceID()
	assert.Equal(t, traceID, get.SpanContext().TraceID())
	assert.Equal(t, traceID, compile.SpanContext().TraceID())
}
