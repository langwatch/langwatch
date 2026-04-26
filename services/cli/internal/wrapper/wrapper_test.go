package wrapper

import (
	"testing"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

func TestEnvForTool(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		GatewayURL: "https://gw.example.com",
		DefaultPersonalVK: config.PersonalVK{
			Secret: "lw_vk_test_abc",
		},
	}

	tests := []struct {
		tool          string
		wantHaveKeys  []string
		wantHaveValue map[string]string // subset
	}{
		{
			tool:         "claude",
			wantHaveKeys: []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"},
			wantHaveValue: map[string]string{
				"ANTHROPIC_BASE_URL":   "https://gw.example.com/api/v1/anthropic",
				"ANTHROPIC_AUTH_TOKEN": "lw_vk_test_abc",
			},
		},
		{
			tool:         "codex",
			wantHaveKeys: []string{"OPENAI_BASE_URL", "OPENAI_API_KEY"},
		},
		{
			tool:         "cursor",
			wantHaveKeys: []string{"OPENAI_BASE_URL", "OPENAI_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"},
		},
		{
			tool:         "gemini",
			wantHaveKeys: []string{"GOOGLE_GENAI_API_BASE", "GEMINI_API_KEY"},
		},
		{
			tool:         "unknown",
			wantHaveKeys: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.tool, func(t *testing.T) {
			got := EnvForTool(cfg, tc.tool)
			gotMap := map[string]string{}
			for _, kv := range got {
				gotMap[kv.Key] = kv.Value
			}

			if len(tc.wantHaveKeys) == 0 && len(got) != 0 {
				t.Fatalf("expected no env vars for %q, got %v", tc.tool, got)
			}
			for _, k := range tc.wantHaveKeys {
				if _, ok := gotMap[k]; !ok {
					t.Errorf("expected key %q to be set for tool %q", k, tc.tool)
				}
			}
			for k, want := range tc.wantHaveValue {
				if gotMap[k] != want {
					t.Errorf("for tool %q key %q: want %q got %q", tc.tool, k, want, gotMap[k])
				}
			}
		})
	}
}

func TestMergeEnvOverrides(t *testing.T) {
	t.Parallel()

	base := []string{
		"PATH=/usr/bin",
		"ANTHROPIC_BASE_URL=https://api.anthropic.com", // pre-existing — should be overridden
		"OTHER=keep-me",
	}
	out := mergeEnv(base, []EnvKV{
		{"ANTHROPIC_BASE_URL", "https://gw.example.com/api/v1/anthropic"},
		{"ANTHROPIC_AUTH_TOKEN", "lw_vk_test"},
	})

	got := map[string]string{}
	for _, kv := range out {
		for j := 0; j < len(kv); j++ {
			if kv[j] == '=' {
				got[kv[:j]] = kv[j+1:]
				break
			}
		}
	}

	if got["ANTHROPIC_BASE_URL"] != "https://gw.example.com/api/v1/anthropic" {
		t.Errorf("expected override of ANTHROPIC_BASE_URL, got %q", got["ANTHROPIC_BASE_URL"])
	}
	if got["ANTHROPIC_AUTH_TOKEN"] != "lw_vk_test" {
		t.Errorf("expected appended ANTHROPIC_AUTH_TOKEN, got %q", got["ANTHROPIC_AUTH_TOKEN"])
	}
	if got["PATH"] != "/usr/bin" {
		t.Errorf("expected PATH preserved, got %q", got["PATH"])
	}
	if got["OTHER"] != "keep-me" {
		t.Errorf("expected OTHER preserved, got %q", got["OTHER"])
	}
}
