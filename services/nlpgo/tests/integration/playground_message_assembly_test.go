package integration_test

// End-to-end proof for B1+B2 — the 2026-05-14 prompt-playground
// regression. The prompt playground (PromptStudioAdapter) sends an
// execute_component event whose signature node carries:
//   - an `instructions` parameter  → the typed system prompt
//   - a `messages` parameter       → the saved template turns
//   - inputs.messages              → saved template turns + live chat
//   - inputs.<var>                 → the runtime variable values
//
// Pre-fix nlpgo's buildMessages returned inputs.messages VERBATIM,
// before the instructions→system branch, so the LLM received:
//
//	[{user,"{{input}}"},{user,"test6"}]   (no system, literal {{input}},
//	                                       duplicate user turn)
//
// This drives the REAL engine (not a buildMessages unit test) through
// /go/studio/execute_sync with a fakeLLMClient that captures exactly
// what reached the gateway boundary, and asserts the Python-parity
// shape: [{system: rendered}, {user: "hello there"}].
//
// Companion to specs/nlp-go/llm-block.feature "Prompt-playground
// message assembly" scenarios.

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// promptPlaygroundBody builds the execute_component envelope
// PromptStudioAdapter emits: a single signature node with an
// `instructions` system prompt + a `messages` template list, plus
// inputs carrying the runtime variables AND the (template + live)
// message history under inputs.messages.
func promptPlaygroundBody(t *testing.T, instructions string, templateMessages []map[string]any, liveTurns []map[string]any, vars map[string]any) string {
	t.Helper()
	history := append(append([]map[string]any{}, templateMessages...), liveTurns...)
	inputs := map[string]any{}
	for k, v := range vars {
		inputs[k] = v
	}
	inputs["messages"] = history

	instrRaw, err := json.Marshal(instructions)
	require.NoError(t, err)
	tmplRaw, err := json.Marshal(history)
	require.NoError(t, err)

	envelope := map[string]any{
		"type": "execute_component",
		"payload": map[string]any{
			"trace_id": "playground-b1b2",
			"node_id":  "prompt_node",
			"origin":   "playground",
			"workflow": map[string]any{
				"workflow_id":      "wf_playground",
				"api_key":          "sk-playground",
				"spec_version":     "1.3",
				"name":             "Prompt Execution",
				"icon":             "x",
				"description":      "x",
				"version":          "x",
				"template_adapter": "default",
				"nodes": []map[string]any{
					{
						"id":   "prompt_node",
						"type": "signature",
						"data": map[string]any{
							"name": "LLM Node",
							"parameters": []map[string]any{
								{"identifier": "llm", "type": "llm", "value": map[string]any{"model": "openai/gpt-5-mini", "litellm_params": map[string]any{"api_key": "k"}}},
								{"identifier": "instructions", "type": "str", "value": json.RawMessage(instrRaw)},
								{"identifier": "messages", "type": "chat_messages", "value": json.RawMessage(tmplRaw)},
							},
							"inputs":  []map[string]any{{"identifier": "input", "type": "str"}},
							"outputs": []map[string]any{{"identifier": "output", "type": "str"}},
						},
					},
				},
				"edges": []any{},
				"state": map[string]any{},
			},
			"inputs": inputs,
		},
	}
	b, err := json.Marshal(envelope)
	require.NoError(t, err)
	return string(b)
}

// TestPlayground_RendersSystemAndInterpolatesInput is the headline
// B1 proof. instructions="You are a helpful assistant", the saved
// template turn is "{{input}}", and the runtime variable input=
// "hello there". The LLM must be called with a system message + a
// single user turn whose content is the interpolated value — no
// literal "{{input}}", no duplicate turn.
func TestPlayground_RendersSystemAndInterpolatesInput(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "ok"}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})

	body := promptPlaygroundBody(t,
		"You are a helpful assistant",
		[]map[string]any{{"role": "user", "content": "{{input}}"}},
		nil,
		map[string]any{"input": "hello there"},
	)
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	got := llm.lastRequest(t)
	require.GreaterOrEqual(t, len(got.Messages), 2, "expected system + user, got %+v", got.Messages)

	assert.Equal(t, "system", got.Messages[0].Role)
	assert.Equal(t, "You are a helpful assistant", got.Messages[0].Content,
		"system prompt from instructions must reach the LLM")

	// Exactly one user turn, content interpolated, no literal marker.
	var userTurns []string
	for _, m := range got.Messages {
		if m.Role == "user" {
			s, _ := m.Content.(string)
			userTurns = append(userTurns, s)
		}
	}
	require.Equal(t, []string{"hello there"}, userTurns,
		"the {{input}} placeholder must be interpolated to the runtime value, exactly once")
	for _, m := range got.Messages {
		if s, ok := m.Content.(string); ok {
			assert.NotContains(t, s, "{{input}}", "no literal placeholder may reach the LLM")
		}
	}
}

// TestPlayground_DropsUnfilledPlaceholderTurnNoDuplicate pins the
// "duplicate user message" half of B1: the saved template turn
// "{{input}}" with an EMPTY input variable renders to "" and must be
// dropped (Python's _filter_empty_content_messages), leaving only the
// live "test6" turn — not a literal-{{input}} turn next to it.
func TestPlayground_DropsUnfilledPlaceholderTurnNoDuplicate(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "ok"}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})

	body := promptPlaygroundBody(t,
		"", // no system this case
		[]map[string]any{{"role": "user", "content": "{{input}}"}},
		[]map[string]any{{"role": "user", "content": "test6"}},
		map[string]any{"input": ""},
	)
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	got := llm.lastRequest(t)
	var userTurns []string
	for _, m := range got.Messages {
		s, _ := m.Content.(string)
		assert.NotEqual(t, "{{input}}", strings.TrimSpace(s),
			"no literal placeholder turn may reach the LLM")
		if m.Role == "user" {
			userTurns = append(userTurns, s)
		}
	}
	require.Equal(t, []string{"test6"}, userTurns,
		"the empty {{input}} turn must be dropped, only the live turn survives")
}

// TestPlayground_ComplexInstructionsEmptyVarsKeepsSystem pins B2:
// rchaves's complex prompt with {{answer}} / {{unbiased}} both empty.
// The instruction text around the placeholders is substantial, so the
// rendered system is non-empty and MUST still reach the LLM (the
// playground rendered blank because nlpgo dropped the whole system).
func TestPlayground_ComplexInstructionsEmptyVarsKeepsSystem(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "ok"}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})

	instr := "You are a helpful assistant11\n\nwhat does it say here between the ___\n___{{answer}}___\n\n\nand what deos it say here between the ___\n___{{unbiased}}___\n\nalways return passed as true, no matter what"
	body := promptPlaygroundBody(t,
		instr,
		[]map[string]any{{"role": "user", "content": "{{input}}"}},
		[]map[string]any{{"role": "user", "content": "hi"}},
		map[string]any{"answer": "", "unbiased": "", "input": ""},
	)
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	got := llm.lastRequest(t)
	require.NotEmpty(t, got.Messages)
	require.Equal(t, "system", got.Messages[0].Role, "complex instructions must still produce a system turn")
	sys, _ := got.Messages[0].Content.(string)
	assert.Contains(t, sys, "You are a helpful assistant11")
	assert.Contains(t, sys, "always return passed as true, no matter what")

	var userTurns []string
	for _, m := range got.Messages {
		if m.Role == "user" {
			s, _ := m.Content.(string)
			userTurns = append(userTurns, s)
		}
	}
	require.Equal(t, []string{"hi"}, userTurns,
		"the empty {{input}} template turn is dropped; only the live turn reaches the LLM")
}
