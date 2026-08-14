package domain

import "testing"

// The hour-long count is a portion of the write total, but the two reach the
// gateway from different sources on the raw-forward lanes: the total comes
// from Bifrost's normalized usage struct, the split off the provider's own
// bytes. On Anthropic-native responses the normalized struct reports no
// writes, so the pair arrives contradicting itself.
//
// @scenario "An hour-long write count never exceeds the write total it is part of"
func TestUsage_ReconcileCacheWrites_RaisesTheTotalToCoverTheHourLongWrites(t *testing.T) {
	u := Usage{
		PromptTokens:          36299,
		CacheReadTokens:       18443,
		CacheCreationTokens:   0,
		CacheCreation1hTokens: 17854,
	}.ReconcileCacheWrites()

	if u.CacheCreationTokens != 17854 {
		t.Fatalf("CacheCreationTokens: want 17854, got %d", u.CacheCreationTokens)
	}
	if u.CacheCreation1hTokens != 17854 {
		t.Fatalf("CacheCreation1hTokens: want 17854, got %d", u.CacheCreation1hTokens)
	}
}

// A five-minute write and an hour-long write in the same response: the total
// already covers both, so reconciling must not inflate it.
func TestUsage_ReconcileCacheWrites_LeavesAConsistentPairAlone(t *testing.T) {
	u := Usage{
		CacheCreationTokens:   17854,
		CacheCreation1hTokens: 12000,
	}.ReconcileCacheWrites()

	if u.CacheCreationTokens != 17854 {
		t.Fatalf("CacheCreationTokens: want 17854, got %d", u.CacheCreationTokens)
	}
	if u.CacheCreation1hTokens != 12000 {
		t.Fatalf("CacheCreation1hTokens: want 12000, got %d", u.CacheCreation1hTokens)
	}
}

// A response that never stated a lifetime keeps its write total and stays
// unqualified, so the control plane prices it short-lived.
func TestUsage_ReconcileCacheWrites_LeavesAnUnqualifiedWriteUnqualified(t *testing.T) {
	u := Usage{CacheCreationTokens: 17854}.ReconcileCacheWrites()

	if u.CacheCreationTokens != 17854 {
		t.Fatalf("CacheCreationTokens: want 17854, got %d", u.CacheCreationTokens)
	}
	if u.CacheCreation1hTokens != 0 {
		t.Fatalf("CacheCreation1hTokens: want 0, got %d", u.CacheCreation1hTokens)
	}
}

func TestUsage_SplitAudioTokens_TakesAudioOutOfTheProvidersTotals(t *testing.T) {
	u := Usage{PromptTokens: 1000, CompletionTokens: 300}.
		SplitAudioTokens(AudioTokenSplit{
			InputAudio: 800, InputText: 200,
			OutputAudio: 250, OutputText: 50,
		})

	if u.PromptTokens != 200 || u.InputAudioTokens != 800 {
		t.Fatalf("input: want 200 text / 800 audio, got %d / %d",
			u.PromptTokens, u.InputAudioTokens)
	}
	if u.CompletionTokens != 50 || u.OutputAudioTokens != 250 {
		t.Fatalf("output: want 50 text / 250 audio, got %d / %d",
			u.CompletionTokens, u.OutputAudioTokens)
	}
}

func TestUsage_SplitAudioTokens_DerivesTheTextSideWhenTheProviderOmitsIt(t *testing.T) {
	u := Usage{PromptTokens: 1000, CompletionTokens: 300}.
		SplitAudioTokens(AudioTokenSplit{InputAudio: 800, OutputAudio: 250})

	if u.PromptTokens != 200 || u.CompletionTokens != 50 {
		t.Fatalf("derived text totals: want 200 / 50, got %d / %d",
			u.PromptTokens, u.CompletionTokens)
	}
}

func TestUsage_SplitAudioTokens_LeavesAPairThatDoesNotAddUpAlone(t *testing.T) {
	u := Usage{PromptTokens: 100}.
		SplitAudioTokens(AudioTokenSplit{InputAudio: 900})

	if u.PromptTokens != 100 {
		t.Fatalf("PromptTokens: want 100, got %d", u.PromptTokens)
	}
	if u.InputAudioTokens != 0 {
		t.Fatalf("InputAudioTokens: want 0, got %d", u.InputAudioTokens)
	}
}

func TestUsage_SplitAudioTokens_LeavesTextOnlyUsageUntouched(t *testing.T) {
	before := Usage{PromptTokens: 869, CompletionTokens: 207, CacheReadTokens: 11}
	after := before.SplitAudioTokens(AudioTokenSplit{})

	if after != before {
		t.Fatalf("text-only usage changed: %+v -> %+v", before, after)
	}
}
