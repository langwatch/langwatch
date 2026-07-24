package httpapi

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestStudioSpanNameAndType_UsesWorkflowNameWhenProvided pins the root-
// span naming priority: the operator-visible workflow name wins over the
// generic event-type label. Without this, a trace list with multiple
// runs of different workflows all read "execute_flow" and operators
// cannot tell which is which at a glance (rchaves dogfood 2026-05-14).
// langwatch.span.type stays strictly event-type-driven so Studio's color
// dispatcher (workflow/evaluation/component) keeps working regardless
// of the user-typed name.
func TestStudioSpanNameAndType_UsesWorkflowNameWhenProvided(t *testing.T) {
	cases := []struct {
		eventType    string
		workflowName string
		wantName     string
		wantType     string
	}{
		{"execute_flow", "Translation Agent", "Translation Agent", "workflow"},
		{"execute_evaluation", "QA Eval", "QA Eval", "evaluation"},
		{"execute_component", "Classify", "Classify", "component"},
		// Empty workflow name → fall back to event-type label so the
		// row still has a label (sub-workflow / curl / malformed payload).
		{"execute_flow", "", "execute_flow", "workflow"},
		{"execute_evaluation", "", "execute_evaluation", "evaluation"},
		{"execute_component", "", "execute_component", "component"},
		// Unknown event type → "workflow" + event-type fallback name.
		{"", "", "execute_flow", "workflow"},
		{"some_future_type", "Pipeline X", "Pipeline X", "workflow"},
	}
	for _, tc := range cases {
		name, spanType := studioSpanNameAndType(tc.eventType, tc.workflowName)
		assert.Equal(t, tc.wantName, name, "name for eventType=%q workflowName=%q", tc.eventType, tc.workflowName)
		assert.Equal(t, tc.wantType, spanType, "type for eventType=%q workflowName=%q", tc.eventType, tc.workflowName)
	}
}
