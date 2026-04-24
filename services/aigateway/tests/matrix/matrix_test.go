// Package matrix runs the provider × scenario coverage matrix against a live
// gateway + control plane + real provider credentials. Build-tagged per
// provider (live_openai, live_anthropic, …) so CI's default `go test ./...`
// never triggers real provider spend.
//
// Pre-requisites (env vars; missing = t.Skip):
//
//	GATEWAY_URL          http://localhost:5563
//	LW_PROJECT_API_KEY   sk-lw-...              (for /api/trace/:id readback)
//	LW_BASE_URL          http://localhost:5560  (optional, defaults to this)
//
// Per-provider VK env vars (a VK with the provider's credentials bound):
//
//	TEST_VK_OPENAI       lw_vk_live_...
//	TEST_VK_ANTHROPIC    lw_vk_live_...
//	TEST_VK_GEMINI       lw_vk_live_...
//	TEST_VK_BEDROCK      lw_vk_live_...
//	TEST_VK_AZURE        lw_vk_live_...
//	TEST_VK_VERTEX       lw_vk_live_...
//
// Each cell asserts four invariants:
//  1. Gateway returns HTTP 200.
//  2. Response has a valid X-LangWatch-Trace-Id header.
//  3. Response body has non-zero usage.prompt_tokens + usage.completion_tokens.
//  4. Within 30s the LangWatch ingest pipeline has the trace with
//     metrics.total_cost > 0 (verifying the full gateway → OTLP → ingest →
//     cost-calc chain, not just provider passthrough).
package matrix

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// cell is one row of the matrix: a {provider, scenario, request body} tuple.
type cell struct {
	provider string // "openai" | "anthropic" | "gemini" | "bedrock" | "azure" | "vertex"
	scenario string // "simple" | "streamed" | "tool_calling" | "structured_outputs"
	body     func(model string) []byte
}

// resolvedCell pairs a cell with the VK + model resolved from env vars so each
// test can run standalone without a shared fixture.
type resolvedCell struct {
	cell
	vk        string // "lw_vk_live_..."
	model     string // e.g. "gpt-5-mini"
	streaming bool
}

// gatewayURL resolves the gateway base URL from env, defaulting to localhost.
func gatewayURL() string {
	if v := os.Getenv("GATEWAY_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://localhost:5563"
}

// lwBaseURL resolves the control-plane base URL for trace readback.
func lwBaseURL() string {
	if v := os.Getenv("LW_BASE_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://localhost:5560"
}

// requireEnv returns the env var value or calls t.Skip if unset.
// Reserves t.Fatal for bugs, never for missing config — a missing key is
// "this cell can't run here", not a failure.
func requireEnv(t *testing.T, key string) string {
	t.Helper()
	v := os.Getenv(key)
	if v == "" {
		t.Skipf("%s not set — skipping live provider test", key)
	}
	return v
}

// chatBody_Simple builds a minimal /v1/chat/completions request.
func chatBody_Simple(model string) []byte {
	return mustJSON(map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "user", "content": "Respond with exactly one word: ok"},
		},
		"max_tokens": 16,
	})
}

// chatBody_Streamed is identical but with stream=true + usage opt-in.
func chatBody_Streamed(model string) []byte {
	return mustJSON(map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "user", "content": "Count from 1 to 5, one number per line."},
		},
		"max_tokens":     48,
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
	})
}

// chatBody_ToolCalling exercises OpenAI-compatible function/tool calling.
func chatBody_ToolCalling(model string) []byte {
	return mustJSON(map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "user", "content": "What's the weather in Berlin? Use the tool."},
		},
		"tools": []map[string]any{
			{
				"type": "function",
				"function": map[string]any{
					"name":        "get_weather",
					"description": "Get the current weather for a city.",
					"parameters": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"city": map[string]any{"type": "string"},
						},
						"required": []string{"city"},
					},
				},
			},
		},
		"max_tokens": 64,
	})
}

// chatBody_StructuredOutputs asks for a JSON-shaped response.
func chatBody_StructuredOutputs(model string) []byte {
	return mustJSON(map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "system", "content": "Reply ONLY with a compact JSON object {\"city\": string, \"country\": string}."},
			{"role": "user", "content": "Paris"},
		},
		"response_format": map[string]any{"type": "json_object"},
		"max_tokens":      64,
	})
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // test-time panic is acceptable — input is constant
	}
	return b
}

// fireAndAssert runs one resolved cell against the live gateway and asserts
// the four invariants. Returns the trace id for downstream cost verification.
func fireAndAssert(t *testing.T, rc resolvedCell) string {
	t.Helper()

	body := rc.body(rc.model)
	req, err := http.NewRequest("POST", gatewayURL()+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+rc.vk)
	req.Header.Set("Content-Type", "application/json")
	if rc.streaming {
		req.Header.Set("Accept", "text/event-stream")
	}

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("gateway POST: %v", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d\nbody: %s", resp.StatusCode, raw)
	}

	traceID := resp.Header.Get("X-LangWatch-Trace-Id")
	if traceID == "" {
		t.Fatalf("missing X-LangWatch-Trace-Id header in response")
	}

	// For non-streaming, the body is a single JSON envelope with `usage`.
	// For streaming, the final SSE chunk carries usage when `include_usage`
	// was requested — for this smoke we accept either and let the
	// platform-side trace readback verify token counts.
	if !rc.streaming {
		var parsed struct {
			Usage struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			t.Fatalf("decode completion body: %v\nbody: %s", err, raw)
		}
		if parsed.Usage.PromptTokens == 0 {
			t.Errorf("usage.prompt_tokens == 0 (expected >0); body: %s", raw)
		}
		if parsed.Usage.CompletionTokens == 0 {
			t.Errorf("usage.completion_tokens == 0 (expected >0); body: %s", raw)
		}
	}

	return traceID
}

// assertTraceCaptured polls the LangWatch trace endpoint until the trace lands
// with metrics.total_cost > 0 or the budget expires. Uses the project API
// key so this hits the same ingest path a customer would read.
func assertTraceCaptured(t *testing.T, traceID string) float64 {
	t.Helper()
	apiKey := requireEnv(t, "LW_PROJECT_API_KEY")

	deadline := time.Now().Add(30 * time.Second)
	backoff := 500 * time.Millisecond
	url := lwBaseURL() + "/api/trace/" + traceID

	for {
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("X-Auth-Token", apiKey)
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == 200 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			var parsed struct {
				Trace struct {
					Metrics struct {
						TotalCost   float64 `json:"total_cost"`
						TotalTokens int     `json:"total_tokens"`
					} `json:"metrics"`
				} `json:"trace"`
			}
			if err := json.Unmarshal(body, &parsed); err == nil {
				if parsed.Trace.Metrics.TotalTokens > 0 && parsed.Trace.Metrics.TotalCost > 0 {
					return parsed.Trace.Metrics.TotalCost
				}
			}
		}
		if resp != nil {
			resp.Body.Close()
		}
		if time.Now().After(deadline) {
			t.Fatalf("trace %s did not land with total_cost > 0 within 30s", traceID)
		}
		time.Sleep(backoff)
		if backoff < 4*time.Second {
			backoff *= 2
		}
	}
}

// runCell is the common end-to-end runner: fire → assert HTTP → wait for trace
// with cost. Each provider's test file composes a resolvedCell + calls this.
func runCell(t *testing.T, rc resolvedCell) float64 {
	t.Helper()
	start := time.Now()
	traceID := fireAndAssert(t, rc)
	cost := assertTraceCaptured(t, traceID)
	t.Logf("cell %s/%s: trace=%s duration=%s captured_cost=$%.6f",
		rc.provider, rc.scenario, traceID, time.Since(start), cost)
	return cost
}
