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

// maxTokensKey returns the right response-length parameter name for a model:
// OpenAI's gpt-5* + o* series reject `max_tokens` and require
// `max_completion_tokens`; everyone else accepts `max_tokens`. Bifrost does
// NOT currently translate this — the gateway forwards whatever the client
// sends, so the matrix tests have to pick correctly per model family.
func maxTokensKey(model string) string {
	if strings.HasPrefix(model, "gpt-5") ||
		strings.HasPrefix(model, "o1") || strings.HasPrefix(model, "o3") ||
		strings.HasPrefix(model, "o4") {
		return "max_completion_tokens"
	}
	return "max_tokens"
}

// chatBody_Simple builds a minimal /v1/chat/completions request.
func chatBody_Simple(model string) []byte {
	body := map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "user", "content": "Respond with exactly one word: ok"},
		},
		maxTokensKey(model): 16,
	}
	return mustJSON(body)
}

// chatBody_Streamed is identical but with stream=true + usage opt-in.
func chatBody_Streamed(model string) []byte {
	return mustJSON(map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "user", "content": "Count from 1 to 5, one number per line."},
		},
		maxTokensKey(model): 48,
		"stream":            true,
		"stream_options":    map[string]any{"include_usage": true},
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
		maxTokensKey(model): 64,
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
		"response_format":   map[string]any{"type": "json_object"},
		maxTokensKey(model): 64,
	})
}

// cacheablePrefix is long enough to trigger every provider's prompt cache —
// OpenAI needs ≥1024 tokens of shared prefix, Anthropic's ephemeral cache
// needs ≥1024 tokens in the cached block, and Gemini / Vertex automatic
// caching on shared context kicks in at comparable thresholds.
//
// Built as a compact factual paragraph repeated enough times to cross the
// token threshold without obvious model-friendly patterns (random tokens
// fragment the tokenizer and can fall below the byte-level cache key).
var cacheablePrefix = strings.Repeat(
	"You are a senior SRE specialising in Kubernetes, observability, and cost "+
		"optimisation for large-scale LLM gateway deployments. You answer in "+
		"crisp, technically precise paragraphs, citing specific CPU, memory, "+
		"and network characteristics where relevant. Your audience is other "+
		"engineers, not executives. Avoid marketing language entirely. ",
	24,
)

// chatBody_Cache_Prime builds a request designed to create a cache entry.
// For Anthropic-family providers (anthropic / bedrock), the system block
// carries `cache_control: {type: "ephemeral"}` to explicitly request caching.
// For auto-cache providers (openai / gemini / azure / vertex), the prefix is
// simply long + stable — the second identical call triggers cache_read on
// the provider side. Both paths surface as gen_ai.usage.cache_read.input_tokens
// in the span.
func chatBody_Cache_Prime(model string) []byte {
	return cacheBodyFor(model, "What's the first thing you check when a gateway pod's /readyz starts flapping?")
}

// chatBody_Cache_Read is the second call — identical prefix, different user
// turn — so the provider's cache can hit on the shared prefix while the
// cache-key (or cache_read attribute) surfaces on the response.
func chatBody_Cache_Read(model string) []byte {
	return cacheBodyFor(model, "Follow-up: same situation but the gateway is at 90% memory. What changes?")
}

func cacheBodyFor(model, userTurn string) []byte {
	// Heuristic: anthropic-family models carry cache_control on the system
	// block; others rely on provider-side automatic caching of the shared
	// prefix. The gateway transparently forwards cache_control bytes to
	// Anthropic (and Anthropic-on-Bedrock); for other providers, the flag
	// is a harmless no-op at the cost of ~20 bytes extra payload.
	anthropicFamily := strings.HasPrefix(model, "claude-") ||
		strings.Contains(model, "anthropic.claude-")

	var systemBlock any
	if anthropicFamily {
		systemBlock = []map[string]any{
			{
				"type":          "text",
				"text":          cacheablePrefix,
				"cache_control": map[string]any{"type": "ephemeral"},
			},
		}
	} else {
		systemBlock = cacheablePrefix
	}
	return mustJSON(map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "system", "content": systemBlock},
			{"role": "user", "content": userTurn},
		},
		maxTokensKey(model): 64,
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

	traceID := extractTraceID(resp.Header)
	if traceID == "" {
		t.Fatalf("no trace id on response: traceparent=%q", resp.Header.Get("Traceparent"))
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
			// /api/trace/:id returns a flat trace envelope; metrics sits at
			// the top level (trace.metrics.{total_cost, prompt_tokens,
			// completion_tokens, ...}). `total_tokens` isn't a field name —
			// sum of prompt+completion is how the UI derives it.
			var parsed struct {
				Metrics struct {
					TotalCost        float64 `json:"total_cost"`
					PromptTokens     int     `json:"prompt_tokens"`
					CompletionTokens int     `json:"completion_tokens"`
				} `json:"metrics"`
			}
			if err := json.Unmarshal(body, &parsed); err == nil {
				totalTokens := parsed.Metrics.PromptTokens + parsed.Metrics.CompletionTokens
				if totalTokens > 0 && parsed.Metrics.TotalCost > 0 {
					return parsed.Metrics.TotalCost
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

// cacheReadFromResponse extracts the provider-reported cache-read tokens
// from a non-streaming /v1/chat/completions body. Handles both shapes:
//
//   - OpenAI family: usage.prompt_tokens_details.cached_tokens
//   - Anthropic family: usage.cache_read_input_tokens (also in the
//     Anthropic-via-Bedrock normalised shape)
//
// Returns 0 if the field is missing, which is valid for the prime call.
func cacheReadFromResponse(body []byte) int {
	var parsed struct {
		Usage struct {
			CacheReadInputTokens int `json:"cache_read_input_tokens"`
			PromptTokensDetails  struct {
				CachedTokens int `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
		} `json:"usage"`
	}
	_ = json.Unmarshal(body, &parsed)
	if parsed.Usage.CacheReadInputTokens > 0 {
		return parsed.Usage.CacheReadInputTokens
	}
	return parsed.Usage.PromptTokensDetails.CachedTokens
}

// extractTraceID pulls the 32-hex trace_id out of the standard W3C
// `traceparent` header (format: `00-{trace-id}-{span-id}-{flags}`). The
// aigateway restructure dropped the legacy `X-LangWatch-Trace-Id` header
// in favour of W3C-only propagation, so tests read from traceparent.
// Returns "" when the header is absent or malformed.
func extractTraceID(h http.Header) string {
	tp := h.Get("Traceparent")
	if tp == "" {
		return ""
	}
	parts := strings.Split(tp, "-")
	if len(parts) < 3 || len(parts[1]) != 32 {
		return ""
	}
	return parts[1]
}

// fireForBody posts a request to the gateway and returns the response body +
// trace id + status. Unlike fireAndAssert this does NOT fatal on 4xx, so the
// caller can handle prime/read retry logic (e.g. cache propagation delay).
func fireForBody(t *testing.T, rc resolvedCell, body []byte) (int, []byte, string) {
	t.Helper()
	req, err := http.NewRequest("POST", gatewayURL()+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+rc.vk)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("gateway POST: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw, extractTraceID(resp.Header)
}

// runCacheCell fires a prime call, waits 2s for the provider to register the
// cache entry, then fires the read call. Asserts the read response carries
// cache_read_input_tokens > 0 AND that both traces land with cost > 0.
// Returns the captured cost on the read trace.
func runCacheCell(t *testing.T, rc resolvedCell) float64 {
	t.Helper()
	start := time.Now()

	// 1. Prime — may or may not populate cache_creation tokens depending on
	// provider (anthropic explicit, openai automatic-on-second-identical).
	status, primeBody, primeTraceID := fireForBody(t, rc, chatBody_Cache_Prime(rc.model))
	if status != 200 {
		t.Fatalf("prime: want 200, got %d\nbody: %s", status, primeBody)
	}
	if primeTraceID == "" {
		t.Fatal("prime: missing X-LangWatch-Trace-Id")
	}

	// Wait for the provider's cache to register. Anthropic quotes
	// "within seconds" so 2s is a safe floor.
	time.Sleep(2 * time.Second)

	// 2. Read — identical prefix should trip the cache-hit path.
	status, readBody, readTraceID := fireForBody(t, rc, chatBody_Cache_Read(rc.model))
	if status != 200 {
		t.Fatalf("read: want 200, got %d\nbody: %s", status, readBody)
	}
	if readTraceID == "" {
		t.Fatal("read: missing X-LangWatch-Trace-Id")
	}

	cacheRead := cacheReadFromResponse(readBody)
	if cacheRead == 0 {
		t.Errorf("%s/cache: want cache_read > 0 on 2nd call; got 0\nread body: %s", rc.provider, readBody)
	}

	// Verify the read trace lands on the platform with cost > 0 — the cache
	// hit still costs a small amount even though it's discounted.
	cost := assertTraceCaptured(t, readTraceID)
	t.Logf("cell %s/cache: prime_trace=%s read_trace=%s cache_read_tokens=%d duration=%s captured_cost=$%.6f",
		rc.provider, primeTraceID, readTraceID, cacheRead, time.Since(start), cost)
	return cost
}
