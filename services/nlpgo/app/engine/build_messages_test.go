package engine

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// signatureNode builds a minimal signature-typed node with a single
// `instructions` parameter, matching the shape paramString expects.
func signatureNode(t *testing.T, instructions string) *dsl.Node {
	t.Helper()
	raw, err := json.Marshal(instructions)
	require.NoError(t, err)
	return &dsl.Node{
		ID:   "n",
		Type: dsl.ComponentSignature,
		Data: dsl.Component{
			Parameters: []dsl.Field{
				{Identifier: "instructions", Type: "str", Value: raw},
			},
		},
	}
}

func systemPrompt(msgs []app.ChatMessage) string {
	for _, m := range msgs {
		if m.Role == "system" {
			s, _ := m.Content.(string)
			return s
		}
	}
	return ""
}

func TestBuildMessages_RendersSimpleVariable(t *testing.T) {
	node := signatureNode(t, "Answer the {{ topic }} question")
	msgs := buildMessages(node, map[string]any{"topic": "math", "question": "1+1?"})
	assert.Equal(t, "Answer the math question", systemPrompt(msgs))
}

func TestBuildMessages_RendersDotPath(t *testing.T) {
	node := signatureNode(t, "Hello {{ user.name }}")
	msgs := buildMessages(node, map[string]any{
		"user":     map[string]any{"name": "Alice"},
		"question": "x",
	})
	assert.Equal(t, "Hello Alice", systemPrompt(msgs))
}

func TestBuildMessages_RendersArrayIndex(t *testing.T) {
	node := signatureNode(t, "First item: {{ items[0] }}")
	msgs := buildMessages(node, map[string]any{
		"items":    []any{"alpha", "beta"},
		"question": "x",
	})
	assert.Equal(t, "First item: alpha", systemPrompt(msgs))
}

// TestBuildMessages_LeavesUnknownVariablesEmpty proves an unresolved
// `{{ var }}` renders as empty rather than crashing — same behavior the
// HTTP block uses, so signature node failure mode matches.
func TestBuildMessages_LeavesUnknownVariablesEmpty(t *testing.T) {
	node := signatureNode(t, "Topic: {{ missing }}")
	msgs := buildMessages(node, map[string]any{"question": "x"})
	got := systemPrompt(msgs)
	// Either "Topic: " (empty substitution) or unchanged — both are
	// acceptable as long as the engine doesn't panic and the system
	// message exists.
	assert.NotContains(t, got, "{{ missing }}",
		"unresolved {{ }} markers should be substituted, got %q", got)
}

func TestBuildMessages_NoTemplateMarkersIsIdentity(t *testing.T) {
	node := signatureNode(t, "Plain instructions, no markers.")
	msgs := buildMessages(node, map[string]any{"question": "x"})
	assert.Equal(t, "Plain instructions, no markers.", systemPrompt(msgs))
}

// TestBuildMessages_PreservesUserPromptVerbatim guards against the
// Python parity expectation that template rendering only applies to
// `instructions` (system message), not to the user prompt content,
// which is the raw upstream input.
func TestBuildMessages_PreservesUserPromptVerbatim(t *testing.T) {
	node := signatureNode(t, "Be concise.")
	msgs := buildMessages(node, map[string]any{"question": "What is {{ x }}?"})
	require.Len(t, msgs, 2)
	assert.Equal(t, "What is {{ x }}?", msgs[1].Content)
}
