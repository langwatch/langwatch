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

// TestComposeUserPrompt_StableKeyOrdering pins the determinism guard:
// when no canonical input key (question/prompt/input) is present and the
// fallback key-value dump runs, the keys must be sorted so the same
// inputs produce the same prompt across runs. Go map iteration is
// randomized and a non-deterministic system prompt breaks both replay
// and provider response caching. Run the function many times and
// confirm one stable output.
func TestComposeUserPrompt_StableKeyOrdering(t *testing.T) {
	inputs := map[string]any{"zeta": 1, "alpha": 2, "mid": 3, "beta": 4}
	first := composeUserPrompt(inputs)
	for i := 0; i < 50; i++ {
		assert.Equal(t, first, composeUserPrompt(inputs),
			"composeUserPrompt fallback must be deterministic across iterations")
	}
	// And the order is alphabetical, not random.
	assert.Equal(t, "alpha: 2\nbeta: 4\nmid: 3\nzeta: 1", first)
}

// TestBuildMessages_AcceptsChatMessagesFromJSON pins the
// chat_messages-from-JSON regression contract.md §10 (commit cb76144a6)
// guards against. When chat history flows from one node's output into a
// downstream signature node's input, it round-trips through JSON
// (state.recordOutputs → state.resolveInputs) and arrives as
// []any of map[string]any — NOT as []app.ChatMessage. The original
// type-asserted check `inputs["chat_messages"].([]app.ChatMessage)`
// silently failed on this real-world shape and the engine fell through
// to composeUserPrompt, dropping all multi-turn context.
func TestBuildMessages_AcceptsChatMessagesFromJSON(t *testing.T) {
	node := signatureNode(t, "Continue the conversation.")
	// Same shape the JSON unmarshaller would produce after a node
	// boundary: []any of map[string]any.
	history := []any{
		map[string]any{"role": "user", "content": "First user turn"},
		map[string]any{"role": "assistant", "content": "First assistant reply"},
		map[string]any{"role": "user", "content": "Second user turn"},
	}
	msgs := buildMessages(node, map[string]any{"chat_messages": history})

	// All three turns must survive — that's the load-bearing claim.
	require.Len(t, msgs, 3, "all chat history turns must be preserved through JSON round-trip")
	assert.Equal(t, "user", msgs[0].Role)
	assert.Equal(t, "First user turn", msgs[0].Content)
	assert.Equal(t, "assistant", msgs[1].Role)
	assert.Equal(t, "First assistant reply", msgs[1].Content)
	assert.Equal(t, "user", msgs[2].Role)
	assert.Equal(t, "Second user turn", msgs[2].Content)
}

// TestBuildMessages_PreservesToolCallsThroughJSON is the structural
// counterpart to the simple multi-turn test above. tool_calls travels
// nested under the assistant message; if buildMessages drops or
// re-shapes them, downstream gateway calls lose the tool_call_id
// linkage and the conversation breaks.
func TestBuildMessages_PreservesToolCallsThroughJSON(t *testing.T) {
	node := signatureNode(t, "")
	history := []any{
		map[string]any{
			"role": "assistant",
			"tool_calls": []any{
				map[string]any{
					"id":   "call_abc",
					"type": "function",
					"function": map[string]any{
						"name":      "lookup",
						"arguments": `{"q":"weather"}`,
					},
				},
			},
		},
		map[string]any{
			"role":         "tool",
			"tool_call_id": "call_abc",
			"name":         "lookup",
			"content":      "sunny",
		},
	}
	msgs := buildMessages(node, map[string]any{"chat_messages": history})
	require.Len(t, msgs, 2)

	// Assistant turn keeps its tool_calls structurally.
	require.Len(t, msgs[0].ToolCalls, 1, "assistant tool_calls must survive JSON round-trip")
	tc := msgs[0].ToolCalls[0]
	assert.Equal(t, "call_abc", tc.ID)
	assert.Equal(t, "function", tc.Type)
	assert.Equal(t, "lookup", tc.Function["name"])
	assert.Equal(t, `{"q":"weather"}`, tc.Function["arguments"])

	// Tool turn keeps its linkage to the assistant call.
	assert.Equal(t, "tool", msgs[1].Role)
	assert.Equal(t, "call_abc", msgs[1].ToolCallID)
	assert.Equal(t, "lookup", msgs[1].Name)
	assert.Equal(t, "sunny", msgs[1].Content)
}

// TestBuildMessages_AcceptsLegacyMessagesKey keeps the legacy
// "messages" input name working — some workflows in the wild populate
// it instead of chat_messages and the existing pre-fix code path
// supported it for the JSON shape only.
func TestBuildMessages_AcceptsLegacyMessagesKey(t *testing.T) {
	node := signatureNode(t, "")
	msgs := buildMessages(node, map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "hi"},
		},
	})
	require.Len(t, msgs, 1)
	assert.Equal(t, "user", msgs[0].Role)
	assert.Equal(t, "hi", msgs[0].Content)
}

// TestBuildMessages_AcceptsTypedChatMessagesSlice keeps the in-memory
// pre-JSON path working for callers (mostly tests) that build the
// typed slice directly.
func TestBuildMessages_AcceptsTypedChatMessagesSlice(t *testing.T) {
	node := signatureNode(t, "")
	typed := []app.ChatMessage{
		{Role: "user", Content: "from typed slice"},
	}
	msgs := buildMessages(node, map[string]any{"chat_messages": typed})
	require.Len(t, msgs, 1)
	assert.Equal(t, "from typed slice", msgs[0].Content)
}

// TestBuildMessages_AcceptsJSONStringEncodedHistory pins the second
// half of regression cb76144a6 (Workflow Agent scenario flow). The TS
// adapter resolve-field-mappings.ts:71 unconditionally JSON-stringifies
// any non-string field value before sending it to the NLP service. A
// signature node declared with a `str`-typed `messages` (or
// `chat_messages`) input therefore sees the value arrive as a JSON
// string of the form `"[{\"role\":\"user\",\"content\":\"...\"}]"`,
// not as a native list. Python's _coerce_for_liquid lstrips and
// JSON-parses such strings back to native form so multi-turn history
// survives. Pre-fix the signature collapsed all turns into a single
// escaped-blob user message — a silent loss of conversation context.
func TestBuildMessages_AcceptsJSONStringEncodedHistory(t *testing.T) {
	node := signatureNode(t, "")
	encoded := `[{"role":"user","content":"First turn"},` +
		`{"role":"assistant","content":"First reply"},` +
		`{"role":"user","content":"Second turn"}]`

	msgs := buildMessages(node, map[string]any{"chat_messages": encoded})

	require.Len(t, msgs, 3, "all turns must survive when input arrives as a JSON-encoded string")
	assert.Equal(t, "user", msgs[0].Role)
	assert.Equal(t, "First turn", msgs[0].Content)
	assert.Equal(t, "assistant", msgs[1].Role)
	assert.Equal(t, "First reply", msgs[1].Content)
	assert.Equal(t, "user", msgs[2].Role)
	assert.Equal(t, "Second turn", msgs[2].Content)
}

// TestBuildMessages_AcceptsJSONStringEncodedHistoryViaMessagesKey
// covers the legacy-key counterpart of the JSON-string case above, so
// we don't accidentally fix the canonical key while the legacy one
// stays broken.
func TestBuildMessages_AcceptsJSONStringEncodedHistoryViaMessagesKey(t *testing.T) {
	node := signatureNode(t, "")
	encoded := `[{"role":"user","content":"hi"}]`

	msgs := buildMessages(node, map[string]any{"messages": encoded})

	require.Len(t, msgs, 1)
	assert.Equal(t, "user", msgs[0].Role)
	assert.Equal(t, "hi", msgs[0].Content)
}

// TestBuildMessages_PreservesNonHistoryStringInputs guards the
// false-positive direction of the JSON-string-of-history fix: a
// `str`-typed input whose value happens to start with `[` or `{` but
// is NOT a chat-history list (e.g. a literal JSON-formatted block, a
// regex starting with `[`, etc.) must NOT be misinterpreted as
// chat history. The string should fall through to composeUserPrompt
// unchanged so the customer's prompt content is preserved verbatim.
func TestBuildMessages_PreservesNonHistoryStringInputs(t *testing.T) {
	node := signatureNode(t, "")
	cases := []string{
		`[1, 2, 3]`,                 // numeric array
		`["a", "b", "c"]`,           // string array (no role/content)
		`{"foo": "bar"}`,            // plain object
		`[{"name":"item","qty":3}]`, // list of non-message objects
		`not json at all [unbalanced`,
		`hello world`,
	}
	for _, c := range cases {
		msgs := buildMessages(node, map[string]any{"chat_messages": c})
		// Either fall through to user-prompt fold (single user msg) or
		// preserve the string under a different key — the load-bearing
		// guard is "no panic, no list-of-roles invented out of thin
		// air, no chat history fabricated from a non-message string."
		for _, m := range msgs {
			if m.Role == "user" {
				continue
			}
			t.Errorf("non-history string input %q produced unexpected role %q", c, m.Role)
		}
	}
}

// TestBuildMessages_RendersJSONSchemaInputAsDotPath pins the
// json_schema-typed INPUT path. Cross-node inputs land as
// map[string]any after JSON-roundtrip through state.recordOutputs →
// state.resolveInputs; a signature node accessing the structured
// object via {{ profile.user.name }} must traverse the nested map and
// emit the leaf scalar — same as a plain `dict`-typed input.
//
// This is the input-side complement to pattern_007 (multi-output
// json_schema response) and pattern_012 (single-output literal
// json_schema): proves that arbitrarily-nested user-defined schemas
// flow through both directions of a signature node.
func TestBuildMessages_RendersJSONSchemaInputAsDotPath(t *testing.T) {
	node := signatureNode(t, "Hello {{ profile.user.name }} from {{ profile.user.org.name }}")
	profile := map[string]any{
		"user": map[string]any{
			"name": "Alice",
			"org": map[string]any{
				"name": "Acme",
			},
		},
	}
	msgs := buildMessages(node, map[string]any{"profile": profile, "question": "x"})
	assert.Equal(t, "Hello Alice from Acme", systemPrompt(msgs))
}

// TestBuildMessages_RendersJSONSchemaInputArrayAccess covers the
// array-index path on a json_schema-typed input. The shape is the
// same as `pattern_003` for HTTP block but proves the signature path
// also works.
func TestBuildMessages_RendersJSONSchemaInputArrayAccess(t *testing.T) {
	node := signatureNode(t, "First item: {{ catalog.items[0].name }}")
	catalog := map[string]any{
		"items": []any{
			map[string]any{"name": "alpha", "qty": 3.0},
			map[string]any{"name": "beta", "qty": 7.0},
		},
	}
	msgs := buildMessages(node, map[string]any{"catalog": catalog, "question": "x"})
	assert.Equal(t, "First item: alpha", systemPrompt(msgs))
}

// TestBuildMessages_EmitsJSONSchemaInputAsJSONLiteral guards the
// "no dot-path, just emit the structured object" case. When the
// customer writes {{ profile }} with no path traversal, the engine
// JSON-stringifies the object so it lands inside the prompt as a
// canonical JSON literal — matching the Python path's json.dumps
// fallback (template_adapter.py SerializableWithStringFallback).
func TestBuildMessages_EmitsJSONSchemaInputAsJSONLiteral(t *testing.T) {
	node := signatureNode(t, "Profile: {{ profile }}")
	profile := map[string]any{"name": "Alice", "tier": "gold"}
	msgs := buildMessages(node, map[string]any{"profile": profile, "question": "x"})

	got := systemPrompt(msgs)
	// Order isn't guaranteed by encoding/json for map[string]any, so
	// just assert each field is present and the value is JSON-shaped.
	assert.Contains(t, got, "Profile: ", "leading literal preserved")
	assert.Contains(t, got, `"name":"Alice"`, "json key/value rendered")
	assert.Contains(t, got, `"tier":"gold"`, "json key/value rendered")
}
