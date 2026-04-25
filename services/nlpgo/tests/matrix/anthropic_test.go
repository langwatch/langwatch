//go:build live_anthropic

package matrix

import (
	"context"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// TestAnthropic_SimpleCompletion verifies the anthropic round-trip and
// implicitly exercises the model-id translation (dot→dash) since the
// model id reaches the gateway in the dashed form.
func TestAnthropic_SimpleCompletion(t *testing.T) {
	mc := loadContext(t)
	apiKey := requireEnv(t, "ANTHROPIC_API_KEY")
	model := envOrDefault("ANTHROPIC_MODEL", "anthropic/claude-3-5-sonnet-20240620")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, model, map[string]any{
		"api_key": apiKey,
	})
	assertContent(t, resp)
}

// TestAnthropic_AliasExpansion verifies the bare alias "claude-sonnet-4"
// expands to the full dated version before the gateway dispatches.
// The provider call would 404 if the alias-expansion lookup were stale,
// so a 200 here proves the alias map is in sync with the TS source.
func TestAnthropic_AliasExpansion(t *testing.T) {
	mc := loadContext(t)
	apiKey := requireEnv(t, "ANTHROPIC_API_KEY")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, "anthropic/claude-sonnet-4", map[string]any{
		"api_key": apiKey,
	})
	assertContent(t, resp)
}

// TestAnthropic_TemperatureClamp asserts the executor's [0,1] clamp by
// requesting temperature=1.5 and observing a 200. Without the clamp,
// Anthropic would 400 and we'd have a typed GatewayHTTPError.
func TestAnthropic_TemperatureClamp(t *testing.T) {
	mc := loadContext(t)
	apiKey := requireEnv(t, "ANTHROPIC_API_KEY")
	exec := newExecutor(t, mc)

	model := envOrDefault("ANTHROPIC_MODEL", "anthropic/claude-3-5-sonnet-20240620")
	temp := 1.5
	maxTok := 32

	ctx, cancel := context.WithTimeout(
		llmexecutor.WithOrigin(context.Background(), "workflow"),
		60*time.Second,
	)
	defer cancel()
	resp, err := exec.Execute(ctx, app.LLMRequest{
		Model:         model,
		Messages:      []app.ChatMessage{{Role: "user", Content: "Reply with just 'ok'."}},
		Temperature:   &temp,
		MaxTokens:     &maxTok,
		LiteLLMParams: map[string]any{"api_key": apiKey},
		ProjectID:     "matrix-test",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if resp.Content == "" {
		t.Errorf("expected content; clamp may have failed and provider rejected the request")
	}
}
