//go:build live_gemini

package matrix

import "testing"

// TestGemini_SimpleCompletion verifies Gemini AI Studio (api-key based,
// distinct from Vertex AI). Model id is namespaced with gemini/.
//
// Required env:
//   - GEMINI_API_KEY
//   - GEMINI_MODEL (defaults to gemini-2.0-flash)
func TestGemini_SimpleCompletion(t *testing.T) {
	mc := loadContext(t)
	apiKey := requireEnv(t, "GEMINI_API_KEY")
	model := envOrDefault("GEMINI_MODEL", "gemini/gemini-2.0-flash")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, model, map[string]any{
		"api_key": apiKey,
	})
	assertContent(t, resp)
}
