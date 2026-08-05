package litellm

import (
	"maps"
	"testing"
)

// toolsBody is the shape the scenario judge sends: a forced tool choice
// over two tools, and no reasoning field at all. That last part is the
// whole bug — the model applies its own server-side default effort, sees
// the tools, and 400s, so there is nothing in the request to strip.
func toolsBody() map[string]any {
	return map[string]any{
		"model": "gpt-5.6-sol",
		"tools": []any{
			map[string]any{"type": "function", "function": map[string]any{"name": "continue_test"}},
			map[string]any{"type": "function", "function": map[string]any{"name": "finish_test"}},
		},
		"tool_choice": "required",
	}
}

// @scenario "a conflicting model sending tools has its reasoning turned off"
func TestEnforceReasoningToolCompat_DisablesReasoningForConflictingModel(t *testing.T) {
	body := toolsBody()

	outcome := EnforceReasoningToolCompat("gpt-5.6-sol", EndpointChatCompletions, body)

	if outcome != ReasoningToolsDisabled {
		t.Fatalf("outcome = %v; want ReasoningToolsDisabled", outcome)
	}
	if body["reasoning_effort"] != "none" {
		t.Errorf("reasoning_effort = %v; want \"none\"", body["reasoning_effort"])
	}
	tools, ok := body["tools"].([]any)
	if !ok || len(tools) != 2 {
		t.Errorf("tools must survive untouched, got %v", body["tools"])
	}
	if body["tool_choice"] != "required" {
		t.Errorf("tool_choice = %v; want it left alone", body["tool_choice"])
	}
}

// The provider-prefixed id is what the in-process executor path carries;
// the proxy path strips the prefix first. Both have to resolve.
func TestEnforceReasoningToolCompat_ResolvesPrefixedAndBareIDs(t *testing.T) {
	for _, modelID := range []string{
		"openai/gpt-5.6-sol", "gpt-5.6-sol", "OpenAI/GPT-5.6-Sol",
		"openai/gpt-5.6-luna-pro", "gpt-5.6-terra",
	} {
		body := toolsBody()
		if got := EnforceReasoningToolCompat(modelID, EndpointChatCompletions, body); got != ReasoningToolsDisabled {
			t.Errorf("EnforceReasoningToolCompat(%q) = %v; want ReasoningToolsDisabled", modelID, got)
		}
	}
}

// The narrowness pin. gpt-5.1 reasons, can disable reasoning, and lists
// tools — every ingredient except a declared conflict. A blanket "strip
// reasoning when tools are present" rule would silently downgrade it, and
// with it nearly every reasoning model we serve.
//
// @scenario "a reasoning model with no declared conflict keeps its reasoning"
func TestEnforceReasoningToolCompat_LeavesUnconflictedReasoningModelsAlone(t *testing.T) {
	for _, modelID := range []string{
		"openai/gpt-5.1", "openai/gpt-5.2", "openai/gpt-5", "openai/o3",
		"openai/gpt-5-mini", "anthropic/claude-opus-4-8-fast",
		"gemini/gemini-3.6-flash",
	} {
		body := toolsBody()
		body["reasoning_effort"] = "high"

		outcome := EnforceReasoningToolCompat(modelID, EndpointChatCompletions, body)

		if outcome != ReasoningToolsCompatible {
			t.Errorf("EnforceReasoningToolCompat(%q) = %v; want ReasoningToolsCompatible", modelID, outcome)
		}
		if body["reasoning_effort"] != "high" {
			t.Errorf("%q: reasoning_effort = %v; want \"high\" (unchanged)", modelID, body["reasoning_effort"])
		}
	}
}

// @scenario "a conflicting model with no tools keeps its reasoning"
func TestEnforceReasoningToolCompat_LeavesToollessRequestsAlone(t *testing.T) {
	cases := map[string]map[string]any{
		"no tools key":     {"reasoning_effort": "high"},
		"nil tools":        {"reasoning_effort": "high", "tools": nil},
		"empty tools":      {"reasoning_effort": "high", "tools": []any{}},
		"empty typed list": {"reasoning_effort": "high", "tools": []string{}},
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			outcome := EnforceReasoningToolCompat("gpt-5.6-sol", EndpointChatCompletions, body)

			if outcome != ReasoningToolsCompatible {
				t.Fatalf("outcome = %v; want ReasoningToolsCompatible", outcome)
			}
			if body["reasoning_effort"] != "high" {
				t.Errorf("reasoning_effort = %v; want \"high\" (unchanged)", body["reasoning_effort"])
			}
		})
	}
}

// A typed slice reaches this function on the in-process executor path,
// where the body is built in Go rather than unmarshalled from JSON.
func TestEnforceReasoningToolCompat_DetectsTypedToolSlices(t *testing.T) {
	type tool struct{ Name string }
	body := map[string]any{"tools": []tool{{Name: "finish_test"}}}

	if got := EnforceReasoningToolCompat("gpt-5.6-sol", EndpointChatCompletions, body); got != ReasoningToolsDisabled {
		t.Fatalf("outcome = %v; want ReasoningToolsDisabled", got)
	}
	if body["reasoning_effort"] != "none" {
		t.Errorf("reasoning_effort = %v; want \"none\"", body["reasoning_effort"])
	}
}

// @scenario "the conflict is scoped to the endpoint it was declared on"
func TestEnforceReasoningToolCompat_IsScopedToTheDeclaredEndpoint(t *testing.T) {
	for _, endpoint := range []string{EndpointResponses, EndpointMessages, "", "generate_content"} {
		body := toolsBody()
		body["reasoning_effort"] = "high"

		outcome := EnforceReasoningToolCompat("gpt-5.6-sol", endpoint, body)

		if outcome != ReasoningToolsCompatible {
			t.Errorf("endpoint %q: outcome = %v; want ReasoningToolsCompatible", endpoint, outcome)
		}
		if body["reasoning_effort"] != "high" {
			t.Errorf("endpoint %q: reasoning_effort = %v; want \"high\" (unchanged)", endpoint, body["reasoning_effort"])
		}
	}
}

// @scenario "a model that cannot disable reasoning is passed through untouched"
func TestEnforceReasoningToolCompat_ReportsIrreconcilableWithoutTouchingTheBody(t *testing.T) {
	const modelID = "openai/gpt-5.6-fixture-locked"
	restore := reasoningToolConflicts[modelID]
	_, existed := reasoningToolConflicts[modelID]
	reasoningToolConflicts[modelID] = reasoningToolConflict{
		conflictEndpoints: []string{EndpointChatCompletions},
		canDisable:        false,
	}
	t.Cleanup(func() {
		if existed {
			reasoningToolConflicts[modelID] = restore
			return
		}
		delete(reasoningToolConflicts, modelID)
	})

	body := toolsBody()
	body["reasoning_effort"] = "high"
	before := maps.Clone(body)

	outcome := EnforceReasoningToolCompat(modelID, EndpointChatCompletions, body)

	if outcome != ReasoningToolsIrreconcilable {
		t.Fatalf("outcome = %v; want ReasoningToolsIrreconcilable", outcome)
	}
	if len(body) != len(before) {
		t.Fatalf("body gained or lost keys: %v -> %v", before, body)
	}
	for key, want := range before {
		if key == "tools" {
			continue
		}
		if body[key] != want {
			t.Errorf("body[%q] = %v; want %v (untouched)", key, body[key], want)
		}
	}
}

// @scenario "the alias spellings of reasoning effort collapse before the override"
func TestEnforceReasoningToolCompat_CollapsesAliasSpellings(t *testing.T) {
	for _, alias := range []string{"reasoning", "thinkingLevel", "effort"} {
		body := toolsBody()
		body[alias] = "high"

		if got := EnforceReasoningToolCompat("gpt-5.6-sol", EndpointChatCompletions, body); got != ReasoningToolsDisabled {
			t.Fatalf("alias %q: outcome = %v; want ReasoningToolsDisabled", alias, got)
		}
		if _, present := body[alias]; present {
			t.Errorf("alias %q survived alongside reasoning_effort", alias)
		}
		if body["reasoning_effort"] != "none" {
			t.Errorf("alias %q: reasoning_effort = %v; want \"none\"", alias, body["reasoning_effort"])
		}
	}
}

// An unknown model is not a reason to change anything. Custom and
// self-hosted model ids never appear in the registry.
func TestEnforceReasoningToolCompat_LeavesUnknownModelsAlone(t *testing.T) {
	for _, modelID := range []string{
		"custom/Qwen/Qwen2.5-32B-Instruct", "", "gpt-5.6", "gpt-5.6-sol-turbo",
	} {
		body := toolsBody()
		if got := EnforceReasoningToolCompat(modelID, EndpointChatCompletions, body); got != ReasoningToolsCompatible {
			t.Errorf("EnforceReasoningToolCompat(%q) = %v; want ReasoningToolsCompatible", modelID, got)
		}
		if _, present := body["reasoning_effort"]; present {
			t.Errorf("%q: reasoning_effort was set on an unknown model", modelID)
		}
	}
}

// The generated table is data, so this asserts the shape the runtime
// depends on rather than the contents: every entry names at least one
// known endpoint, and the bare index resolves the family that caused this
// change. Contents live in reasoningcaps.generated.go and move with the
// registry.
func TestReasoningToolConflicts_TableShape(t *testing.T) {
	known := map[string]bool{
		EndpointChatCompletions: true, EndpointResponses: true, EndpointMessages: true,
	}
	for id, conflict := range reasoningToolConflicts {
		if len(conflict.conflictEndpoints) == 0 {
			t.Errorf("%s declares no endpoints; it should not be in the table", id)
		}
		for _, endpoint := range conflict.conflictEndpoints {
			if !known[endpoint] {
				t.Errorf("%s declares unknown endpoint %q", id, endpoint)
			}
		}
	}
	for _, bare := range []string{
		"gpt-5.6-sol", "gpt-5.6-sol-pro", "gpt-5.6-luna",
		"gpt-5.6-luna-pro", "gpt-5.6-terra", "gpt-5.6-terra-pro",
	} {
		if _, ok := bareReasoningToolConflicts[bare]; !ok {
			t.Errorf("%s is missing from the bare index; the proxy path only ever sees bare ids", bare)
		}
	}
}
