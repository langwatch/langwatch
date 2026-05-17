// Prompt-span emission parity tests for the Evaluations-v3 surface.
//
// Pinned by specs/nlp-go/prompt-spans-eval-v3.feature. Per-row
// PromptApiService.get + Prompt.compile spans must be emitted by the
// nlpgo engine when a Evaluations-v3 experiment iterates a target
// bound to a saved prompt, scoped under each row's execution root so
// the trace-UI ancestor walk (findPromptReferenceInAncestors.ts) can
// resolve a single prompt reference per result cell without
// cross-row leakage.

package integration_test

import "testing"

/** @scenario "each evaluated row emits its own PromptApiService.get + Prompt.compile pair" */
func TestPromptSpansEvalV3_EachRowEmitsItsOwnGetCompilePair(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "per-row spans are scoped under their per-row execution root, not the experiment root" */
func TestPromptSpansEvalV3_PerRowScopingNoLeakage(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "a target that is not a saved prompt emits no PromptApiService.get" */
func TestPromptSpansEvalV3_CodeTargetEmitsNoGet(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "a row whose prompt fetch fails records the exception on its own get span" */
func TestPromptSpansEvalV3_RowFetchFailureRecordedAndOthersUnaffected(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}
