// Prompt-span emission parity tests for the "unsaved/applied prompt
// version" (draft) surface across playground / Studio / Evaluations-v3.
//
// Pinned by specs/nlp-go/prompt-spans-unsaved-version.feature. When a
// user starts from a saved prompt and edits the messages/variables/
// model inline without persisting, the nlpgo engine must keep the
// BASE id/handle/version.* on both spans (so the trace-UI can offer
// "Open <handle>:<base_version> (unsaved edits)" as the resume
// target) and stamp langwatch.prompt.draft=true on Prompt.compile to
// signal divergence from the saved canonical body.

package integration_test

import "testing"

/** @scenario "playground draft — user edits a message inline then sends" */
func TestPromptSpansUnsavedVersion_PlaygroundDraftPreservesBasePlusFlag(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "eval-v3 draft — TargetCell localPromptConfig overrides saved outputs" */
func TestPromptSpansUnsavedVersion_EvalV3DraftPreservesBasePlusFlag(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "Studio signature-node draft — inline tweak before running workflow" */
func TestPromptSpansUnsavedVersion_StudioSignatureNodeDraftPreservesBasePlusFlag(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "saved-version execution does NOT emit a draft attribute (omission, not false)" */
func TestPromptSpansUnsavedVersion_SavedVersionOmitsDraftAttribute(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "fresh ad-hoc prompt is NOT a draft (it has no base to be a draft OF)" */
func TestPromptSpansUnsavedVersion_FreshAdhocIsNotDraft(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "the LLM span's actual input messages are the diverged set, not the saved set" */
func TestPromptSpansUnsavedVersion_LLMSpanInputIsDivergedMessages(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}
