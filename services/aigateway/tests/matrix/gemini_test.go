//go:build live_gemini

package matrix

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

// geminiCell builds a resolved cell for the gemini (Google AI Studio) provider
// using TEST_VK_GEMINI + GEMINI_MODEL (defaults to gemini-2.5-flash).
func geminiCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_GEMINI")
	model := os.Getenv("GEMINI_MODEL")
	if model == "" {
		model = "gemini-2.5-flash"
	}
	return resolvedCell{
		cell:      cell{provider: "gemini", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestGemini_SimpleCompletion(t *testing.T) {
	runCell(t, geminiCell(t, "simple", chatBody_Simple, false))
}

func TestGemini_StreamedCompletion(t *testing.T) {
	runCell(t, geminiCell(t, "streamed", chatBody_Streamed, true))
}

func TestGemini_ToolCalling(t *testing.T) {
	runCell(t, geminiCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestGemini_StructuredOutputs(t *testing.T) {
	runCell(t, geminiCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}

// TestGemini_Cache exercises Gemini's explicit `cachedContents` API end-to-end
// through the gateway. The implicit prefix-cache path returns cached_tokens=0
// on this account tier (no paid-tier billing for implicit caching), so the
// matrix proves the explicit path: one direct-API setup call to mint a cached
// content resource (bypass-the-gateway, holds the long shared prefix), then
// one chat-completions request through the gateway carrying the
// `cached_content: <name>` extension key. The gateway parser lifts the key
// onto Bifrost's ChatParameters.ExtraParams; Bifrost's gemini chat translator
// reads it off ExtraParams and sets geminiReq.CachedContent on the outbound
// generateContent call. Response carries cached_read_tokens > 0.
//
// Requires GEMINI_API_KEY for the setup call (Generative Language API uses
// API-key auth, not OAuth). The matrix-gemini VK still uses the gateway's
// usual credential lookup for the read.
func TestGemini_Cache(t *testing.T) {
	apiKey := requireEnv(t, "GEMINI_API_KEY")
	cell := geminiCell(t, "cache", nil, false)
	runCachedContentCacheCell(t, cell, func(t *testing.T) string {
		t.Helper()
		return createGeminiCachedContent(t, apiKey, cell.model, cacheablePrefix, "120s")
	})
}

// createGeminiCachedContent POSTs to the Gemini Generative Language
// /v1beta/cachedContents endpoint to mint a cached content resource holding
// `prefix`. Returns the full resource name (e.g.
// "cachedContents/abc123") which is the canonical form gemini expects on
// the `cachedContent` field of subsequent generateContent calls.
//
// Direct-API call rather than gateway-routed because the gateway doesn't
// proxy native gemini setup endpoints — and the cell's purpose is to verify
// the GENERATE call's cache-read path through the gateway, not the create
// call. Bypass keeps the test focused.
func createGeminiCachedContent(t *testing.T, apiKey, model, prefix, ttl string) string {
	t.Helper()
	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/cachedContents?key=%s", apiKey)
	body, err := json.Marshal(map[string]any{
		"model": "models/" + model,
		"contents": []map[string]any{
			{"role": "user", "parts": []map[string]any{{"text": prefix}}},
		},
		"ttl": ttl,
	})
	if err != nil {
		t.Fatalf("marshal create-cached body: %v", err)
	}
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build create-cached request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("create-cached POST: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("create cachedContents: HTTP %d\n%s", resp.StatusCode, raw)
	}
	var parsed struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil || parsed.Name == "" {
		t.Fatalf("create cachedContents: parse response: %v\n%s", err, raw)
	}
	return parsed.Name
}
