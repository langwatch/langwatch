package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/sims/llmsim"
)

// A Gemini or Vertex credential with a base-URL override reaches that host,
// here a real llmsim, instead of Google's. See specs/setup/haven-llmsim.feature.
// @scenario "A Gemini or Vertex provider with a base URL reaches that host instead of Google's"
func TestDispatchGeminiAndVertexReachTheBaseURLOverride(t *testing.T) {
	sim := httptest.NewServer(llmsim.NewServer(llmsim.Config{Stack: "test"}).Handler())
	defer sim.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	if err != nil {
		t.Fatalf("NewBifrostRouter: %v", err)
	}
	defer router.Close()

	for _, tc := range []struct {
		name string
		cred domain.Credential
		path string
	}{
		{"gemini", domain.Credential{ID: "mp-gemini", ProviderID: domain.ProviderGemini, APIKey: "llmsim", Extra: map[string]string{"base_url": sim.URL + "/v1beta"}}, "/v1beta/models/gemini-2.5-flash:generateContent"},
		{"vertex", domain.Credential{ID: "mp-vertex", ProviderID: domain.ProviderVertex, Extra: map[string]string{"base_url": sim.URL, "project_id": "p1", "region": "us-central1"}}, "/v1/projects/p1/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := router.Dispatch(context.Background(), &domain.Request{
				Type:     domain.RequestTypeChat,
				Model:    "gemini-2.5-flash",
				Resolved: &domain.ResolvedModel{ModelID: "gemini-2.5-flash", ProviderID: tc.cred.ProviderID},
				Body:     []byte(`{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"hello"}]}`),
			}, tc.cred)
			if err != nil {
				t.Fatalf("Dispatch: %v", err)
			}
			if resp.StatusCode != http.StatusOK || !strings.Contains(string(resp.Body), `"content"`) {
				t.Fatalf("status %d body %s", resp.StatusCode, resp.Body)
			}
			calls, err := http.Get(sim.URL + "/_sim/api/calls")
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = calls.Body.Close() }()
			raw, _ := io.ReadAll(calls.Body)
			var listed struct {
				Calls []struct {
					Path string `json:"path"`
				} `json:"calls"`
			}
			_ = json.Unmarshal(raw, &listed)
			if len(listed.Calls) == 0 || listed.Calls[0].Path != tc.path {
				t.Fatalf("llmsim's newest call should be %s, got %s", tc.path, raw)
			}
		})
	}
}
