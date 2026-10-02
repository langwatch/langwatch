package app

import (
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func llmProviderSeedEnv(t *testing.T, sel domain.Selection) (baseURL, key string) {
	t.Helper()
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), SimulatorArgv: []string{"/bin/haven", "simulator"}}, proxy: stubProxy{}}
	repo := simulatorCheckout(t)
	children := o.planChildren(simulatorStack(repo, domain.LayoutModular), PlanOptions{Selection: sel, RepoRoot: repo}, repo, "")
	api, ok := findChild(children, APILane)
	if !ok {
		t.Fatal("no api lane was planned")
	}
	return valueOf(api.Env, "OPENAI_BASE_URL"), valueOf(api.Env, "OPENAI_API_KEY")
}

// The seed reads OPENAI_API_KEY and OPENAI_BASE_URL from the api lane's
// environment (seedModelProvidersFromEnv), so the env is what decides it.
//
// @scenario "The llmsim model provider is hidden when haven does not enable it"
func TestNoLLMProviderEnvWithoutPlusLLM(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.LLM = false
	if base, key := llmProviderSeedEnv(t, sel); base != "" || key == "llmsim" {
		t.Errorf("api lane carries llmsim provider env (%q, %q) without +llm", base, key)
	}
}

// @scenario "The llmsim model provider is listed and seeded when haven enables it"
func TestLLMProviderEnvSeedsProviderAtLlmsimWithPlusLLM(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.LLM = true
	if base, key := llmProviderSeedEnv(t, sel); base != "http://127.0.0.1:45595/v1" || key != "llmsim" {
		t.Errorf("api lane provider env = (%q, %q), want llmsim's URL and dummy key", base, key)
	}
}
