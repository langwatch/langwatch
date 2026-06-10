//go:build live_embeddings

// Real-API integration tests for the /v1/embeddings route. Mirror the
// shape of the chat matrix tests (per-provider VK + model resolved
// from env) but run against the embedding endpoint, decoding the
// embedding-specific usage / data shape instead of the completion
// envelope.
//
// Anthropic is intentionally absent — Anthropic ships no embeddings
// API. A call lands on Bifrost which surfaces the upstream reject;
// the gateway doesn't fabricate a synthetic error there.

package matrix

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

// embeddingBody_Simple builds a minimal /v1/embeddings request.
func embeddingBody_Simple(model string) []byte {
	return mustJSON(map[string]any{
		"model": model,
		"input": "Embed this short sentence.",
	})
}

// embeddingBody_Batch exercises the array-input shape — common path
// for topic-clustering workloads where many strings get embedded in
// one call.
func embeddingBody_Batch(model string) []byte {
	return mustJSON(map[string]any{
		"model": model,
		"input": []string{
			"Topic clustering needs batched embeddings.",
			"Each row maps to one vector in the response.",
			"Voyage, OpenAI and Gemini accept the same shape.",
		},
	})
}

// openaiEmbeddingsCell composes a resolvedCell pointing at
// /v1/embeddings with the OpenAI VK + embedding model.
func openaiEmbeddingsCell(t *testing.T, scenario string, body func(string) []byte) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_OPENAI")
	model := os.Getenv("EMBEDDINGS_OPENAI_MODEL")
	if model == "" {
		model = "text-embedding-3-small"
	}
	return resolvedCell{
		cell:     cell{provider: "openai", scenario: scenario, body: body},
		vk:       vk,
		model:    model,
		endpoint: "/v1/embeddings",
	}
}

func geminiEmbeddingsCell(t *testing.T, scenario string, body func(string) []byte) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_GEMINI")
	model := os.Getenv("EMBEDDINGS_GEMINI_MODEL")
	if model == "" {
		model = "gemini-embedding-001"
	}
	return resolvedCell{
		cell:     cell{provider: "gemini", scenario: scenario, body: body},
		vk:       vk,
		model:    model,
		endpoint: "/v1/embeddings",
	}
}

func voyageEmbeddingsCell(t *testing.T, scenario string, body func(string) []byte) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_VOYAGE")
	model := os.Getenv("EMBEDDINGS_VOYAGE_MODEL")
	if model == "" {
		model = "voyage-3.5"
	}
	return resolvedCell{
		cell:     cell{provider: "voyage", scenario: scenario, body: body},
		vk:       vk,
		model:    model,
		endpoint: "/v1/embeddings",
	}
}

func TestOpenAI_Embeddings_Simple(t *testing.T) {
	runEmbeddingCell(t, openaiEmbeddingsCell(t, "simple", embeddingBody_Simple))
}

func TestOpenAI_Embeddings_Batch(t *testing.T) {
	runEmbeddingCell(t, openaiEmbeddingsCell(t, "batch", embeddingBody_Batch))
}

func TestGemini_Embeddings_Simple(t *testing.T) {
	runEmbeddingCell(t, geminiEmbeddingsCell(t, "simple", embeddingBody_Simple))
}

func TestGemini_Embeddings_Batch(t *testing.T) {
	runEmbeddingCell(t, geminiEmbeddingsCell(t, "batch", embeddingBody_Batch))
}

func TestVoyage_Embeddings_Simple(t *testing.T) {
	runEmbeddingCell(t, voyageEmbeddingsCell(t, "simple", embeddingBody_Simple))
}

func TestVoyage_Embeddings_Batch(t *testing.T) {
	runEmbeddingCell(t, voyageEmbeddingsCell(t, "batch", embeddingBody_Batch))
}

// runEmbeddingCell is the embeddings-flavoured runner. It mirrors
// runCell's contract (fire → assert HTTP shape → check trace landed)
// but the response invariants are different: embedding endpoints
// return `data[]` with `embedding` vectors and a `usage` block with
// only prompt + total tokens (no completion).
func runEmbeddingCell(t *testing.T, rc resolvedCell) float64 {
	t.Helper()
	start := time.Now()
	traceID := fireEmbeddingsAndAssert(t, rc)
	cost := assertTraceCaptured(t, traceID)
	t.Logf("cell %s/%s: trace=%s duration=%s captured_cost=$%.6f",
		rc.provider, rc.scenario, traceID, time.Since(start), cost)
	return cost
}

// fireEmbeddingsAndAssert posts the embedding request to the gateway
// and asserts the response shape:
//
//   - HTTP 200 with a non-empty traceparent header
//   - body decodes as { data: [{ embedding: [...] }], usage: { prompt_tokens > 0 } }
//   - at least one vector is returned and the first entry has a
//     non-empty embedding array
//
// Returns the traceparent's 32-hex trace id for the downstream cost
// readback in assertTraceCaptured.
func fireEmbeddingsAndAssert(t *testing.T, rc resolvedCell) string {
	t.Helper()

	body := rc.body(rc.model)
	req, err := http.NewRequest(http.MethodPost, gatewayURL()+"/v1/embeddings", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+rc.vk)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("gateway POST: %v", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d\nbody: %s", resp.StatusCode, raw)
	}

	traceID := extractTraceID(resp.Header)
	if traceID == "" {
		t.Fatalf("no trace id on response: traceparent=%q", resp.Header.Get("Traceparent"))
	}

	var parsed struct {
		Data []struct {
			Embedding json.RawMessage `json:"embedding"`
		} `json:"data"`
		Usage struct {
			PromptTokens int `json:"prompt_tokens"`
			TotalTokens  int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("decode embedding body: %v\nbody: %s", err, raw)
	}
	if len(parsed.Data) == 0 {
		t.Fatalf("data[] empty in embedding response\nbody: %s", raw)
	}
	if len(parsed.Data[0].Embedding) == 0 || string(parsed.Data[0].Embedding) == "null" {
		t.Errorf("data[0].embedding missing\nbody: %s", raw)
	}
	if parsed.Usage.PromptTokens == 0 {
		t.Errorf("usage.prompt_tokens == 0 (expected >0)\nbody: %s", raw)
	}
	return traceID
}
