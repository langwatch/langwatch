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

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

/** @scenario "playground draft — user edits a message inline then sends" */
func TestPromptSpansUnsavedVersion_PlaygroundDraftPreservesBasePlusFlag(t *testing.T) {
	// Real assertion (Lane D, 1/3 in this file). Other stubs stay
	// t.Skip — the draft-flag wiring is unit-tested at
	// services/nlpgo/app/engine/prompt_spans_emit_test.go; this
	// integration test pins that the dispatch boundary preserves
	// the base identity AND stamps the flag.
	body := signatureWorkflowBody(t, signatureNodeOpts{
		ConfigID:      "support-router",
		Handle:        "support-router",
		VersionID:     "prompt_version_abc",
		VersionNumber: 6,
		Draft:         true,
		Instructions:  "You are a terse assistant.",
		TemplateMsgs:  []map[string]any{{"role": "user", "content": "{{input}}"}},
	}, map[string]any{"input": "draft test"})

	fx, _ := runPromptSpansDispatch(t, body)

	compile := fx.FindPromptSpan(t, "Prompt.compile")
	attrs := promptSpanAttrs(compile)

	assert.Equal(t, true, attrs["langwatch.prompt.draft"],
		"draft executions must stamp langwatch.prompt.draft=true on Prompt.compile")
	// Base reference stays populated as the resume target — the
	// trace-UI surfaces "Open support-router:6 (unsaved edits)".
	assert.Equal(t, "support-router", attrs["langwatch.prompt.id"])
	assert.Equal(t, "support-router", attrs["langwatch.prompt.handle"])
	assert.Equal(t, "prompt_version_abc", attrs["langwatch.prompt.version.id"])
	assert.Equal(t, int64(6), attrs["langwatch.prompt.version.number"])
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
