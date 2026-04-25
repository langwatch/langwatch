// Package matrix is the nlpgo provider-matrix end-to-end live test
// harness. Tests are gated behind `//go:build live_<provider>` build
// tags so they never run by default — running them costs real money.
//
// Common helpers live here so per-provider files stay tiny.
package matrix

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/adapters/gatewayclient"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// matrixContext bundles env-var lookups so every cell can fail-skip with
// one helper rather than each test re-checking the env. Live tests must
// never fail for missing env — that's a `t.Skip` situation, not an
// assertion error.
type matrixContext struct {
	GatewayURL string
	Secret     string
}

// loadContext reads the gateway connection info common to every cell.
// Skips the test if neither GATEWAY_URL nor LW_GATEWAY_INTERNAL_SECRET
// are set — operators running the full matrix locally will have both.
func loadContext(t *testing.T) matrixContext {
	t.Helper()
	url := os.Getenv("GATEWAY_URL")
	if url == "" {
		url = "http://localhost:5563"
	}
	secret := os.Getenv("LW_GATEWAY_INTERNAL_SECRET")
	if secret == "" {
		t.Skip("LW_GATEWAY_INTERNAL_SECRET not set — start the gateway and load langwatch/.env to run live matrix")
	}
	return matrixContext{GatewayURL: url, Secret: secret}
}

// newExecutor returns a fully-wired LLM executor pointed at the running
// gateway. Each cell can construct it once and reuse across sub-tests.
func newExecutor(t *testing.T, mc matrixContext) *llmexecutor.Executor {
	t.Helper()
	gw, err := gatewayclient.New(gatewayclient.Options{
		BaseURL:        mc.GatewayURL,
		InternalSecret: mc.Secret,
	})
	if err != nil {
		t.Fatalf("gatewayclient.New: %v", err)
	}
	return llmexecutor.New(gw)
}

// requireEnv reads an env var, skipping the test if missing.
func requireEnv(t *testing.T, key string) string {
	t.Helper()
	v := os.Getenv(key)
	if v == "" {
		t.Skipf("env %s not set", key)
	}
	return v
}

// envOrDefault reads an env var, returning a fallback if missing.
func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// runSimpleCompletion fires one chat completion through the executor and
// returns the response, with hard-coded sensible defaults: project
// "matrix-test", origin "workflow", a single user "Hello" message,
// max_tokens=64. Per-provider tests add their model + litellm_params.
func runSimpleCompletion(t *testing.T, exec *llmexecutor.Executor, model string, params map[string]any) *app.LLMResponse {
	t.Helper()
	maxTok := 64
	ctx, cancel := context.WithTimeout(
		llmexecutor.WithOrigin(context.Background(), "workflow"),
		60*time.Second,
	)
	defer cancel()
	resp, err := exec.Execute(ctx, app.LLMRequest{
		Model: model,
		Messages: []app.ChatMessage{
			{Role: "user", Content: "Reply with just the word 'pong'."},
		},
		MaxTokens:     &maxTok,
		LiteLLMParams: params,
		ProjectID:     "matrix-test",
	})
	if err != nil {
		t.Fatalf("Execute %s: %v", model, err)
	}
	return resp
}

// assertContent fails the test if the response has empty content.
func assertContent(t *testing.T, resp *app.LLMResponse) {
	t.Helper()
	if resp.Content == "" {
		t.Errorf("expected non-empty content from %s", resp.Raw)
	}
	if resp.Usage.TotalTokens == 0 {
		t.Errorf("expected non-zero token usage from %s", resp.Raw)
	}
}
