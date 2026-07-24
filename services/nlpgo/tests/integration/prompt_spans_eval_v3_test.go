// Prompt-span emission parity tests for the Evaluations-v3 surface.
//
// Pinned by specs/nlp-go/prompt-spans-eval-v3.feature. Per-row
// PromptApiService.get + Prompt.compile spans must be emitted by the
// nlpgo engine when a Evaluations-v3 experiment iterates a target
// bound to a saved prompt, scoped under each row's execution root so
// the trace-UI ancestor walk (findPromptReferenceInAncestors.ts) can
// resolve a single prompt reference per result cell without
// cross-row leakage.
//
// The orchestrator dispatches one execute_component (origin="evaluation")
// per row; these tests pin the per-dispatch engine contract. The
// app-side forwarding that makes the eval-v3 target node actually carry
// configId / handle / versionMetadata is covered by
// langwatch/src/server/experiments-v3/execution/__tests__/workflowBuilder.test.ts.

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

/** @scenario "each evaluated row emits its own PromptApiService.get + Prompt.compile pair" */
func TestPromptSpansEvalV3_EachRowEmitsItsOwnGetCompilePair(t *testing.T) {
	body := signatureWorkflowBody(t, signatureNodeOpts{
		ConfigID:      "prompt_supportrouter_xyz",
		Handle:        "support-router",
		VersionID:     "prompt_version_supportrouter_v6",
		VersionNumber: 6,
		Instructions:  "You are a support router.",
		Origin:        "evaluation",
	}, map[string]any{"input": "I want a refund"})

	fx, _ := runPromptSpansDispatch(t, body)

	get := promptSpanAttrs(fx.FindPromptSpan(t, "PromptApiService.get"))
	assert.Equal(t, "support-router:6", get["langwatch.prompt.id"],
		"get carries the combined handle:version stamp the drawer resumes")

	compile := promptSpanAttrs(fx.FindPromptSpan(t, "Prompt.compile"))
	assert.Equal(t, "prompt_supportrouter_xyz", compile["langwatch.prompt.id"],
		"compile carries the raw configId (the base reference)")
	assert.Equal(t, "support-router", compile["langwatch.prompt.handle"])
	assert.Equal(t, int64(6), compile["langwatch.prompt.version.number"])

	// The eval-v3 origin must reach the trace so the UI can group per-row
	// prompt spans under the experiment surface (the root span carries it).
	assert.Equal(t, "evaluation", evalV3Origin(fx),
		"the dispatch stamps langwatch.origin=evaluation")
}

/** @scenario "per-row spans are scoped under their per-row execution root, not the experiment root" */
func TestPromptSpansEvalV3_PerRowScopingNoLeakage(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

/** @scenario "a target that is not a saved prompt emits no PromptApiService.get" */
func TestPromptSpansEvalV3_CodeTargetEmitsNoGet(t *testing.T) {
	body := signatureWorkflowBody(t, signatureNodeOpts{
		// No ConfigID → ad-hoc target (e.g. a code/agent target or an
		// inline prompt) → no resolvable saved prompt → no prompt ancestry.
		Instructions: "inline prompt, no saved config",
		Origin:       "evaluation",
	}, map[string]any{"input": "ping"})

	fx, _ := runPromptSpansDispatch(t, body)

	assert.Nil(t, findPromptSpan(fx.rec, "PromptApiService.get"),
		"a non-saved-prompt target must not emit PromptApiService.get")
	assert.Nil(t, findPromptSpan(fx.rec, "Prompt.compile"),
		"a non-saved-prompt target must not emit Prompt.compile")
}

/** @scenario "a row whose prompt fetch fails records the exception on its own get span" */
func TestPromptSpansEvalV3_RowFetchFailureRecordedAndOthersUnaffected(t *testing.T) {
	t.Skip(promptSpansPendingMsg)
}

// evalV3Origin returns the langwatch.origin stamped on the dispatch's
// root span (studioRequestAttrs sets it from payload.origin), or "".
func evalV3Origin(fx *promptSpansFixture) string {
	for _, s := range fx.Spans() {
		for _, a := range s.Attributes() {
			if a.Key == "langwatch.origin" {
				return a.Value.AsString()
			}
		}
	}
	return ""
}
