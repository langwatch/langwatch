package app

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
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
		name     string
		resolved *domain.ResolvedModel
		wantIDs  []string
		wantErr  herr.Code
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
			name:     "explicit provider with no matching cred hard-fails as not bound",
			resolved: &domain.ResolvedModel{ProviderID: domain.ProviderBedrock, ModelID: "bedrock-only"},
			wantErr:  domain.ErrProviderNotBound,
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
			got, err := eligibleCredentials(context.Background(), mkCreds(), tc.resolved)
			if tc.wantErr != "" {
				if !herr.IsCode(err, tc.wantErr) {
					t.Fatalf("got err %v, want code %s", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
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
	got, err := eligibleCredentials(context.Background(), nil, &domain.ResolvedModel{ModelID: "gpt-4o"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
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
	got, err := eligibleCredentials(context.Background(), creds, &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
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

func TestEligibleCredentialsImplicitNoMatchKeepsSafetyNet(t *testing.T) {
	// A bare model name (no provider prefix) whose inferred provider has
	// no credential must NOT hard-fail: without a prefix on the model
	// string, each attempt dispatches with the credential's own provider
	// and surfaces that provider's real error.
	creds := []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
	}
	got, err := eligibleCredentials(context.Background(), creds, &domain.ResolvedModel{ProviderID: "", ModelID: "gemini-2.5-pro"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].ID != "openai_1" {
		t.Errorf("safety net not applied: got %v", got)
	}
}

func TestEligibleCredentialsEmptyChainDefersToNoProviderConfigured(t *testing.T) {
	// A VK with zero credentials is a different customer problem than a
	// VK missing one provider: the org has configured nothing at all, so
	// "bind a bedrock slot" is the wrong advice. This helper stays silent
	// and lets candidateChain raise no_provider_configured, which names
	// the actual next step. Both are 400s, so the status contract holds.
	got, err := eligibleCredentials(context.Background(), nil, &domain.ResolvedModel{
		ProviderID: domain.ProviderBedrock, ModelID: "anthropic.claude-3-5-sonnet",
	})
	if err != nil {
		t.Fatalf("empty chain must not hard-fail here: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty chain to pass through, got %v", got)
	}
}
