package domain

import (
	"math"
	"strings"
	"testing"
)

// @scenario "The warning states the price, not just the fact"
func TestBustPricingFollowsTheCallersCacheLifetime(t *testing.T) {
	t.Run("given a 300k-token prefix", func(t *testing.T) {
		const prefix = 300_000

		t.Run("a sub-agent on the five-minute cache pays the smaller premium", func(t *testing.T) {
			if got := BustPremium(SubAgent); math.Abs(got-1.15) > 1e-9 {
				t.Fatalf("expected a 1.15x premium, got %v", got)
			}
			// 300k * $5/M = $1.50 base; x1.15 = $1.725
			if got := BustCostUSD(prefix, SubAgent); math.Abs(got-1.725) > 0.001 {
				t.Fatalf("expected about $1.73, got %v", got)
			}
		})

		t.Run("a main session on the one-hour cache pays nearly twice that", func(t *testing.T) {
			if got := BustPremium(MainSession); math.Abs(got-1.9) > 1e-9 {
				t.Fatalf("expected a 1.9x premium, got %v", got)
			}
			// 300k * $5/M = $1.50 base; x1.9 = $2.85
			if got := BustCostUSD(prefix, MainSession); math.Abs(got-2.85) > 0.001 {
				t.Fatalf("expected about $2.85, got %v", got)
			}
		})

		t.Run("and the premium is the difference, not the write rate", func(t *testing.T) {
			// The trap an earlier draft fell into: quoting 1.15 as the WRITE rate
			// rather than as write-minus-read.
			if BustPremium(SubAgent) >= cacheWrite5mRate {
				t.Fatal("the premium must be less than the write rate it derives from")
			}
		})
	})
}

// @scenario "A small cached prefix produces no warning at all"
func TestSmallPrefixesAreSilent(t *testing.T) {
	t.Run("given a prefix below the threshold", func(t *testing.T) {
		t.Run("nothing is reported, so the expensive warning stays credible", func(t *testing.T) {
			if got := ChannelFor(ToolSetChange, WarnThresholdTokens-1); got != Silent {
				t.Fatalf("expected silence, got %v", got)
			}
		})
	})

	t.Run("given a large prefix", func(t *testing.T) {
		t.Run("a documented invalidation is worth one interruption", func(t *testing.T) {
			if got := ChannelFor(ModelSwitch, 500_000); got != Confirm {
				t.Fatalf("expected a confirm, got %v", got)
			}
		})

		t.Run("but an unverified one only notifies, matching its certainty", func(t *testing.T) {
			if got := ChannelFor(InstructionsEdit, 500_000); got != Notify {
				t.Fatalf("expected a notify, got %v", got)
			}
		})
	})
}

// @scenario "An edit to an instructions file is flagged with its uncertainty attached"
func TestInvalidationWarningsCarryTheirCertainty(t *testing.T) {
	t.Run("given an instructions edit, which is not verified to invalidate", func(t *testing.T) {
		got := InvalidationWarning(InstructionsEdit, 300_000, MainSession)

		t.Run("the copy hedges rather than asserting", func(t *testing.T) {
			if !strings.Contains(got, "MAY") || !strings.Contains(got, "unverified") {
				t.Fatalf("expected the hedge, got %q", got)
			}
		})
	})

	t.Run("given a model switch, which is documented", func(t *testing.T) {
		got := InvalidationWarning(ModelSwitch, 300_000, MainSession)

		t.Run("it states the consequence plainly and names the price", func(t *testing.T) {
			if strings.Contains(got, "MAY") {
				t.Fatal("a documented invalidation must not hedge")
			}
			if !strings.Contains(got, "no escape hatch") || !strings.Contains(got, "$2.85") {
				t.Fatalf("expected the consequence and the price, got %q", got)
			}
		})
	})
}
