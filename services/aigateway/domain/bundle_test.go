package domain

import (
	"testing"
	"time"
)

// The gateway cache and the control plane have to agree on the boundary
// instant. The control plane refuses the key when its expiration date is at or
// below the current time, so a cache that treated the exact date as still
// valid would serve one request the control plane rejects, and the customer
// would see the key work and then fail for the same instant.
func TestBundleKeyExpired_TreatsTheDateItselfAsExpired(t *testing.T) {
	date := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	bundle := &Bundle{VirtualKeyExpiresAt: date}

	t.Run("when now is before the date", func(t *testing.T) {
		if bundle.KeyExpired(date.Add(-time.Nanosecond)) {
			t.Error("a key one instant short of its date still serves")
		}
	})

	t.Run("when now is exactly the date", func(t *testing.T) {
		if !bundle.KeyExpired(date) {
			t.Error("the expiration instant itself must be refused, matching the control plane")
		}
	})

	t.Run("when now is past the date", func(t *testing.T) {
		if !bundle.KeyExpired(date.Add(time.Nanosecond)) {
			t.Error("a key past its date must be refused")
		}
	})
}

func TestBundleKeyExpired_WithNoDateNeverExpires(t *testing.T) {
	bundle := &Bundle{}

	if bundle.KeyExpired(time.Now().Add(100 * 365 * 24 * time.Hour)) {
		t.Error("the zero value means the key has no expiration date")
	}
}

// KnownProviderFamily accepts any casing, and NormalizeProviderID matches its
// aliases literally. Passing the raw segment through produced the provider id
// "OpenAI", which matches no credential, so a legal spelling routed nowhere.
func TestSplitModelSpellingNormalizesTheQualifierCase(t *testing.T) {
	t.Parallel()

	for _, spelling := range []string{"OpenAI/gpt-5-mini", "OPENAI/gpt-5-mini", "openai/gpt-5-mini"} {
		providerID, model, ok := SplitModelSpelling(spelling)
		if !ok {
			t.Fatalf("%q must split", spelling)
		}
		if providerID != ProviderOpenAI {
			t.Errorf("%q gave provider %q, want %q", spelling, providerID, ProviderOpenAI)
		}
		if model != "gpt-5-mini" {
			t.Errorf("%q gave model %q", spelling, model)
		}
	}

	// The alias table is matched on the lowercased form too.
	providerID, _, ok := SplitModelSpelling("Vertex_AI/gemini-2.5-pro")
	if !ok || providerID != ProviderVertex {
		t.Errorf("mixed-case alias gave %q, ok=%v, want %q", providerID, ok, ProviderVertex)
	}
}
