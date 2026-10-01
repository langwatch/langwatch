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
		"DEEPSEEK_BASE_URL=http://127.0.0.1:45595/v1", "XAI_BASE_URL=http://127.0.0.1:45595/v1",
		"CEREBRAS_BASE_URL=http://127.0.0.1:45595/v1", "GROQ_BASE_URL=http://127.0.0.1:45595/v1",
		"GEMINI_BASE_URL=http://127.0.0.1:45595/v1", "ALLOWED_PROXY_HOSTS=127.0.0.1",
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

// The probe-only providers get a base URL and never a dummy key: a key would seed an
// organization-level row for each, shadowing what a flow adds.
func TestLLMProviderEnvAimsTheProbeOnlyProvidersWithoutKeys(t *testing.T) {
	env := LLMProviderEnv(map[string]string{"GROQ_BASE_URL": "https://proxy.example", "ALLOWED_PROXY_HOSTS": "corp.example"}, 45595)
	for _, line := range env {
		if strings.HasPrefix(line, "GROQ_BASE_URL=") || strings.HasPrefix(line, "ALLOWED_PROXY_HOSTS=") {
			t.Errorf("overlay %v overrides a value .env chose", env)
		}
		for _, key := range []string{"DEEPSEEK_API_KEY", "XAI_API_KEY", "CEREBRAS_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY"} {
			if strings.HasPrefix(line, key+"=") {
				t.Errorf("overlay %v sets %s, which would seed a provider row", env, key)
			}
		}
	}
	if !slices.Contains(env, "XAI_BASE_URL=http://127.0.0.1:45595/v1") {
		t.Errorf("overlay %v does not aim xAI's probe at llmsim", env)
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
