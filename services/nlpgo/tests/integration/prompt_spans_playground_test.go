// Prompt-span emission parity tests for the playground surface.
//
// Pinned by specs/nlp-go/prompt-spans-playground.feature. These tests
// will exercise nlpgo's engine emitting PromptApiService.get +
// Prompt.compile spans byte-equivalent to python-sdk's
// prompt_service_tracing.py + prompt_tracing.py decorators when the
// TS PromptStudioAdapter dispatches a playground send via
// execute_component with origin="playground".
//
// Stubs landed alongside the spec so /** @scenario */ doc comments
// satisfy the parity binder (after the binder patch lands to scan Go
// test roots). The Skip markers go away as the engine emission +
// sdk-go/prompts/ helpers land in this PR.

package integration_test

import "testing"

const promptSpansPendingMsg = "pending: sdk-go/prompts wiring + nlpgo engine emission in this PR"

/** @scenario "playground send on a saved prompt version emits a get+compile span pair" */
func TestPromptSpansPlayground_SavedVersionEmitsGetCompilePair(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "playground send on an unsaved fresh prompt emits compile but no get" */
func TestPromptSpansPlayground_FreshAdhocEmitsCompileOnly(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "every declared variable on the prompt is captured on the compile span" */
func TestPromptSpansPlayground_DeclaredVariablesCapturedOnCompile(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "error during compile records the exception on the compile span" */
func TestPromptSpansPlayground_CompileErrorRecordedOnSpan(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "span hierarchy matches python-sdk shape (get + compile + llm are siblings)" */
func TestPromptSpansPlayground_GetCompileLLMSiblingsUnderSameParent(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}
