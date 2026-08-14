package app

import (
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestEligibleCredentials(t *testing.T) {
	t.Parallel()

	mkCreds := func() []domain.Credential {
		return []domain.Credential{
			{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
			{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
			{ID: "gemini_1", ProviderID: domain.ProviderGemini},
			{ID: "anthropic_2", ProviderID: domain.ProviderAnthropic},
		}
	}

	tests := []struct {
		name            string
		resolved        *domain.ResolvedModel
		wantIDs         []string
		wantUnreachable domain.ProviderID
	}{
		{
			name:     "explicit anthropic provider keeps both anthropic creds in order",
			resolved: &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic, ModelID: "claude-3-5-sonnet"},
			wantIDs:  []string{"anthropic_1", "anthropic_2"},
		},
		{
			name:     "explicit openai provider keeps the single openai cred",
			resolved: &domain.ResolvedModel{ProviderID: domain.ProviderOpenAI, ModelID: "gpt-4o-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit claude- model name infers anthropic",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "claude-3-5-sonnet-20241022"},
			wantIDs:  []string{"anthropic_1", "anthropic_2"},
		},
		{
			name:     "implicit gpt- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "gpt-4o"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit o1- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "o1-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit o3- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "o3-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit o4- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "o4-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit gemini- model name infers gemini",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "gemini-2.5-pro"},
			wantIDs:  []string{"gemini_1"},
		},
		{
			name:     "unknown model leaves chain untouched",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "llama-3-70b"},
			wantIDs:  []string{"anthropic_1", "openai_1", "gemini_1", "anthropic_2"},
		},
		{
			// A provider the request named and the key cannot reach is refused.
			// Dispatching it to whatever is left sent an Anthropic model to
			// Gemini and answered with Gemini's own model-not-found.
			name:            "a named provider the key cannot reach is refused, not rerouted",
			resolved:        &domain.ResolvedModel{ProviderID: domain.ProviderBedrock, ModelID: "bedrock-only"},
			wantIDs:         nil,
			wantUnreachable: domain.ProviderBedrock,
		},
		{
			// The inference is a guess from a short prefix table, so it keeps
			// the whole chain rather than refusing a request the key could
			// have served.
			name:     "an inferred provider the key cannot reach leaves the chain untouched",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "claude-3-5-sonnet"},
			wantIDs:  []string{"anthropic_1", "anthropic_2"},
		},
		{
			name:     "nil resolved leaves chain untouched",
			resolved: nil,
			wantIDs:  []string{"anthropic_1", "openai_1", "gemini_1", "anthropic_2"},
		},
		{
			name:     "case-insensitive on model name",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "Claude-3-Opus"},
			wantIDs:  []string{"anthropic_1", "anthropic_2"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, unreachable := eligibleCredentials(mkCreds(), tc.resolved)
			if unreachable != tc.wantUnreachable {
				t.Errorf("unreachable: got %q want %q", unreachable, tc.wantUnreachable)
			}
			gotIDs := make([]string, len(got))
			for i, c := range got {
				gotIDs[i] = c.ID
			}
			if !equalSlices(gotIDs, tc.wantIDs) {
				t.Errorf("got %v want %v", gotIDs, tc.wantIDs)
			}
		})
	}
}

func TestEligibleCredentialsEmptyChain(t *testing.T) {
	got, _ := eligibleCredentials(nil, &domain.ResolvedModel{ModelID: "gpt-4o"})
	if got != nil {
		t.Errorf("expected nil slice, got %v", got)
	}
}

func TestEligibleCredentialsPreservesPriority(t *testing.T) {
	// When multiple creds match, order MUST be preserved so existing
	// fallback semantics (try first cred, then next) keep working.
	creds := []domain.Credential{
		{ID: "primary_anthropic", ProviderID: domain.ProviderAnthropic},
		{ID: "openai_first", ProviderID: domain.ProviderOpenAI},
		{ID: "secondary_anthropic", ProviderID: domain.ProviderAnthropic},
	}
	got, _ := eligibleCredentials(creds, &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic})
	if len(got) != 2 {
		t.Fatalf("got %d creds, want 2", len(got))
	}
	if got[0].ID != "primary_anthropic" || got[1].ID != "secondary_anthropic" {
		t.Errorf("priority not preserved: got %s, %s", got[0].ID, got[1].ID)
	}
}

func equalSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
