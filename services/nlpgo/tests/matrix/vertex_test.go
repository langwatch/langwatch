//go:build live_vertex

package matrix

import (
	"os"
	"testing"
)

// TestVertex_SimpleCompletion verifies Vertex AI through the inline-
// credentials path. Vertex authenticates with an inline service-account
// JSON (not an api_key). The model id is namespaced with vertex_ai/.
//
// Required env:
//   - VERTEX_CREDENTIALS_FILE (path to JSON file) OR VERTEX_CREDENTIALS_JSON (literal JSON)
//   - VERTEX_PROJECT
//   - VERTEX_LOCATION (e.g. us-central1)
//   - VERTEX_MODEL (e.g. gemini-2.0-flash)
func TestVertex_SimpleCompletion(t *testing.T) {
	mc := loadContext(t)
	credsJSON := os.Getenv("VERTEX_CREDENTIALS_JSON")
	if credsJSON == "" {
		path := requireEnv(t, "VERTEX_CREDENTIALS_FILE")
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read VERTEX_CREDENTIALS_FILE: %v", err)
		}
		credsJSON = string(b)
	}
	project := requireEnv(t, "VERTEX_PROJECT")
	location := envOrDefault("VERTEX_LOCATION", "us-central1")
	modelTail := envOrDefault("VERTEX_MODEL", "gemini-2.0-flash")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, "vertex_ai/"+modelTail, map[string]any{
		"vertex_credentials": credsJSON,
		"vertex_project":     project,
		"vertex_location":    location,
	})
	assertContent(t, resp)
}
