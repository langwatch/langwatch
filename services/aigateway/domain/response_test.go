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
