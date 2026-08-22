//go:build live_models_discovery

// Live verification of hosted-provider model discovery against the real
// provider APIs. Gated behind the `live_models_discovery` build tag and
// env vars so it never runs in normal CI. It proves the production
// hostedModelCatalogs table (URLs, required headers, ID normalization)
// against reality, which is exactly what the unit tests' local override
// servers cannot do.
//
// Run:
//
//	OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... \
//	go test -tags live_models_discovery ./services/aigateway/adapters/providers/ \
//	  -run ModelsDiscoveryLive -count=1 -v
//
// Providers whose key env var is unset are skipped, never failed.
package providers

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestModelsDiscoveryLive_HostedCatalogs(t *testing.T) {
	cases := []struct {
		provider domain.ProviderID
		keyEnv   string
		// idMarker is a substring at least one listed model must carry,
		// pinning that the catalog answered with that provider's models.
		idMarker string
	}{
		{domain.ProviderOpenAI, "OPENAI_API_KEY", "gpt"},
		{domain.ProviderAnthropic, "ANTHROPIC_API_KEY", "claude"},
		{domain.ProviderGemini, "GEMINI_API_KEY", "gemini"},
		{domain.ProviderGroq, "GROQ_API_KEY", "llama"},
		{domain.ProviderXAI, "XAI_API_KEY", "grok"},
		{domain.ProviderDeepSeek, "DEEPSEEK_API_KEY", "deepseek"},
		{domain.ProviderCerebras, "CEREBRAS_API_KEY", "llama"},
		{domain.ProviderOrcaRouter, "ORCAROUTER_API_KEY", "orcarouter"},
	}
	for _, tc := range cases {
		t.Run(string(tc.provider), func(t *testing.T) {
			key := os.Getenv(tc.keyEnv)
			if key == "" {
				t.Skipf("%s not set; skipping live discovery for %s", tc.keyEnv, tc.provider)
			}
			router := &BifrostRouter{}
			models, gaps, err := router.ListModels(context.Background(), []domain.Credential{
				{ID: "live-" + string(tc.provider), ProviderID: tc.provider, APIKey: key},
			})
			if err != nil {
				t.Fatalf("ListModels returned error: %v", err)
			}
			if len(gaps) != 0 {
				t.Fatalf("gaps = %v, want none: the hosted catalog probe must succeed against the live API", gaps)
			}
			if len(models) == 0 {
				t.Fatalf("live %s catalog listed zero models; a key that can dispatch must never list nothing", tc.provider)
			}
			marked := false
			for _, m := range models {
				if m.ProviderID != tc.provider {
					t.Fatalf("model %q attributed to %q, want %q", m.ID, m.ProviderID, tc.provider)
				}
				if strings.Contains(strings.ToLower(m.ID), tc.idMarker) {
					marked = true
				}
				if strings.HasPrefix(m.ID, "models/") {
					t.Fatalf("model %q kept its catalog decoration; dispatch accepts only the bare id", m.ID)
				}
			}
			if !marked {
				t.Fatalf("no listed model contains %q; catalog answer looks wrong: %v", tc.idMarker, models)
			}
			t.Logf("%s: %d models, e.g. %s", tc.provider, len(models), models[0].ID)
		})
	}
}
