package domain

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "haven +llm points the OpenAI and Anthropic providers at llmsim"
func TestLLMProviderEnvPointsProvidersAtLlmsim(t *testing.T) {
	if DefaultSelection().LLM {
		t.Fatal("llm is on in a fresh worktree's selection; it must be opt-in")
	}
	env := LLMProviderEnv(map[string]string{}, 45595)
	for _, want := range []string{
		"OPENAI_BASE_URL=http://127.0.0.1:45595/v1", "OPENAI_API_KEY=llmsim",
		"ANTHROPIC_BASE_URL=http://127.0.0.1:45595", "ANTHROPIC_API_KEY=llmsim",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("overlay %v lacks %q", env, want)
		}
	}
}

// @scenario "A developer's own provider base URL wins over llmsim"
func TestLLMProviderEnvLeavesAChosenProviderAlone(t *testing.T) {
	env := LLMProviderEnv(map[string]string{"OPENAI_BASE_URL": "https://proxy.example", "ANTHROPIC_API_KEY": "real"}, 45595)
	for _, line := range env {
		if line == "OPENAI_API_KEY=llmsim" || line == "ANTHROPIC_API_KEY=llmsim" || strings.HasPrefix(line, "OPENAI_BASE_URL=") {
			t.Errorf("overlay %v overrides a value .env chose", env)
		}
	}
	if !slices.Contains(env, "ANTHROPIC_BASE_URL=http://127.0.0.1:45595") {
		t.Errorf("overlay %v does not route Anthropic, whose base URL .env left unset", env)
	}
}

func TestLLMIsSelectableByName(t *testing.T) {
	if !slices.Contains(SelectableServices, LLMService) {
		t.Fatalf("%q is not selectable", LLMService)
	}
	sel, err := applySelectionDelta(DefaultSelection(), LLMService, true)
	if err != nil || !sel.LLM {
		t.Fatalf("+llm gave %+v, %v", sel, err)
	}
}
