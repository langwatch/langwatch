//go:build live_openai

package matrix

import "testing"

// TestOpenAI_SimpleCompletion verifies the round-trip from nlpgo's
// translator → gateway client → gateway internal-auth middleware →
// Bifrost → OpenAI → and back. Inline credentials carry the api_key.
func TestOpenAI_SimpleCompletion(t *testing.T) {
	mc := loadContext(t)
	apiKey := requireEnv(t, "OPENAI_API_KEY")
	model := envOrDefault("OPENAI_MODEL", "openai/gpt-5-mini")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, model, map[string]any{
		"api_key": apiKey,
	})
	assertContent(t, resp)
}

// TestOpenAI_ReasoningModel exercises the reasoning-model overrides:
// temperature is pinned to 1.0 and max_tokens is floored at 16000
// before the gateway sees the request. We can't directly observe the
// translation here (it's inside the executor), but we can assert the
// gateway didn't reject the request — providers sometimes 400 if they
// see a stale reasoning shape.
func TestOpenAI_ReasoningModel(t *testing.T) {
	mc := loadContext(t)
	apiKey := requireEnv(t, "OPENAI_API_KEY")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, "openai/gpt-5-mini", map[string]any{
		"api_key": apiKey,
	})
	assertContent(t, resp)
}
