//go:build live_vertex

package matrix

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// vertexCell builds a resolved cell for Google Vertex using TEST_VK_VERTEX +
// VERTEX_MODEL (defaults to gemini-2.5-flash, region us-central1).
//
// TEST_VK_VERTEX's bound ModelProvider must carry a vertex_ai credential
// with project_id + location + service-account JSON in customKeys.
// Bifrost handles the GCP auth exchange.
func vertexCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_VERTEX")
	model := os.Getenv("VERTEX_MODEL")
	if model == "" {
		model = "gemini-2.5-flash"
	}
	return resolvedCell{
		cell:      cell{provider: "vertex", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestVertex_SimpleCompletion(t *testing.T) {
	runCell(t, vertexCell(t, "simple", chatBody_Simple, false))
}

func TestVertex_StreamedCompletion(t *testing.T) {
	runCell(t, vertexCell(t, "streamed", chatBody_Streamed, true))
}

func TestVertex_ToolCalling(t *testing.T) {
	runCell(t, vertexCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestVertex_StructuredOutputs(t *testing.T) {
	runCell(t, vertexCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}

// TestVertex_Cache exercises Vertex AI's explicit `cachedContents` API
// end-to-end through the gateway. Same flow as TestGemini_Cache (gateway
// parser → Bifrost ExtraParams → geminiReq.CachedContent), differs only on
// the setup call which uses Vertex's project-scoped cachedContents endpoint
// authenticated with an OAuth2 access token (not API key).
//
// Requires:
//   - VERTEX_PROJECT     GCP project id (e.g. "langwatch")
//   - VERTEX_LOCATION    region (e.g. "us-central1")
//   - VERTEX_ACCESS_TOKEN  OAuth2 token, OR
//   - GOOGLE_APPLICATION_CREDENTIALS  path to a service-account JSON; the
//     test will exec `gcloud auth print-access-token --account=…` to mint
//     a fresh token (matches the local-dev auth flow).
//
// Skip if neither auth path is available — the rest of the matrix still
// runs without GCP creds.
func TestVertex_Cache(t *testing.T) {
	project := requireEnv(t, "VERTEX_PROJECT")
	location := os.Getenv("VERTEX_LOCATION")
	if location == "" {
		location = "us-central1"
	}
	token := vertexAccessToken(t)

	cell := vertexCell(t, "cache", nil, false)
	runCachedContentCacheCell(t, cell, func(t *testing.T) string {
		t.Helper()
		return createVertexCachedContent(t, token, project, location, cell.model, cacheablePrefix, "120s")
	})
}

// vertexAccessToken resolves a GCP OAuth2 access token suitable for calling
// the Vertex AI REST API. Order of preference:
//   - VERTEX_ACCESS_TOKEN env var (CI / preset)
//   - exec `gcloud auth print-access-token` against the configured account
//     (local dev — matches the GOOGLE_APPLICATION_CREDENTIALS flow Bifrost
//     itself uses for the chat call).
//
// Skips the test if neither path produces a token.
func vertexAccessToken(t *testing.T) string {
	t.Helper()
	if v := strings.TrimSpace(os.Getenv("VERTEX_ACCESS_TOKEN")); v != "" {
		return v
	}
	args := []string{"auth", "print-access-token"}
	if account := os.Getenv("VERTEX_GCLOUD_ACCOUNT"); account != "" {
		args = append(args, "--account="+account)
	}
	cmd := exec.Command("gcloud", args...)
	out, err := cmd.Output()
	if err != nil {
		t.Skipf("vertex access token unavailable: gcloud auth print-access-token failed: %v (set VERTEX_ACCESS_TOKEN to skip gcloud)", err)
	}
	tok := strings.TrimSpace(string(out))
	if tok == "" {
		t.Skip("vertex access token unavailable: gcloud returned empty token")
	}
	return tok
}

// createVertexCachedContent POSTs to the Vertex AI cachedContents endpoint.
// Returns the full project-scoped resource name, e.g.
// "projects/<project_number>/locations/<region>/cachedContents/<id>".
// Direct-API call rather than gateway-routed for the same reason as the
// Gemini setup — the cell's purpose is to verify the gateway's GENERATE
// path, not the create path.
func createVertexCachedContent(t *testing.T, token, project, location, model, prefix, ttl string) string {
	t.Helper()
	endpoint := fmt.Sprintf(
		"https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/cachedContents",
		location, project, location,
	)
	body, err := json.Marshal(map[string]any{
		"model": fmt.Sprintf("projects/%s/locations/%s/publishers/google/models/%s", project, location, model),
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
	req.Header.Set("Authorization", "Bearer "+token)
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
