// Package matrix is the nlpgo provider-matrix end-to-end live test
// harness. Tests are gated behind `//go:build live_<provider>` build
// tags so they never run by default — running them costs real money.
//
// Common helpers live here so per-provider files stay tiny.
package matrix

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/dispatcheradapter"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// matrixContext is a placeholder kept for symmetry with per-provider
// cells; the in-process dispatcher needs no per-test config beyond the
// provider keys read inside each cell.
type matrixContext struct{}

// loadContext is a no-op since the library pivot — kept only to give
// per-provider cells a consistent setup hook.
func loadContext(_ *testing.T) matrixContext { return matrixContext{} }

// newExecutor returns a fully-wired LLM executor backed by the
// in-process AI Gateway dispatcher. No HTTP, no HMAC — Bifrost lives
// in the same process. Each cell calls the executor with real
// provider credentials in the LLMRequest's litellm_params.
func newExecutor(t *testing.T, _ matrixContext) *llmexecutor.Executor {
	t.Helper()
	disp, err := dispatcher.New(context.Background(), dispatcher.Options{})
	if err != nil {
		t.Fatalf("dispatcher.New: %v", err)
	}
	return llmexecutor.New(dispatcheradapter.New(disp))
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
		// Surface the upstream provider body when present so failures
		// in the live matrix point straight at the provider's complaint
		// (model id, missing param, auth, etc.) rather than a generic
		// "non-2xx 400". GatewayHTTPError carries the verbatim bytes.
		var ge *llmexecutor.GatewayHTTPError
		if errors.As(err, &ge) {
			t.Fatalf("Execute %s failed (status=%d): %s\nbody: %s",
				model, ge.StatusCode, err, string(ge.Body))
		}
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
