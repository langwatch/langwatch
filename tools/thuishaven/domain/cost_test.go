package domain

import (
	"math"
	"strings"
	"testing"
	"time"
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

// @scenario "A test rerun after an edit is not a repeat"
// @scenario "A tool call repeating identically with no intervening change is stopped"
// @scenario "An interleaved call resets the repeat count"
func TestRepeatDetectorDoesNotBreakTheRedGreenLoop(t *testing.T) {
	key := RepeatKey("Bash", "pnpm test:unit run src/x")

	t.Run("given the same command run repeatedly with nothing changing", func(t *testing.T) {
		state := RepeatState{}
		var denied bool
		for i := 0; i <= RepeatThreshold; i++ {
			state, denied = ObserveCall(state, key)
		}

		t.Run("it is eventually denied", func(t *testing.T) {
			if !denied {
				t.Fatalf("expected a denial past %d repeats", RepeatThreshold)
			}
		})

		t.Run("and the reason tells the caller to change something rather than retry", func(t *testing.T) {
			reason := RepeatDenialReason(state.Count)
			if !strings.Contains(reason, "do not retry it unchanged") {
				t.Fatalf("expected actionable copy, got %q", reason)
			}
		})
	})

	t.Run("given the same command with a file edit in between", func(t *testing.T) {
		state := RepeatState{}
		for range RepeatThreshold + 2 {
			state.EditedSince = true // an edit landed since the last call
			var denied bool
			state, denied = ObserveCall(state, key)
			if denied {
				t.Fatal("the red-green loop must never be denied")
			}
		}
	})

	t.Run("given a different call in between", func(t *testing.T) {
		state := RepeatState{}
		for range RepeatThreshold + 2 {
			state, _ = ObserveCall(state, key)
			state, _ = ObserveCall(state, RepeatKey("Read", "somefile"))
		}

		t.Run("the count never builds up", func(t *testing.T) {
			next, denied := ObserveCall(state, key)
			if denied || next.Count > 1 {
				t.Fatalf("an interleaved call must reset the run, got count %d", next.Count)
			}
		})
	})
}

// @scenario "A spawn count that cannot be trusted admits"
// @scenario "Spawning past the machine-wide agent cap is refused"
func TestSpawnCapExpiresRatherThanFailingClosed(t *testing.T) {
	now := time.Now()

	t.Run("given recent spawns", func(t *testing.T) {
		var recorded []time.Time
		for range MaxConcurrentAgents {
			recorded = append(recorded, now)
		}

		t.Run("they are all counted", func(t *testing.T) {
			if got := LiveSpawns(recorded, now); got != MaxConcurrentAgents {
				t.Fatalf("expected %d live, got %d", MaxConcurrentAgents, got)
			}
		})

		t.Run("and the refusal names the count so it is checkable", func(t *testing.T) {
			if !strings.Contains(SpawnDenialReason(MaxConcurrentAgents), "do not sleep") {
				t.Fatal("the refusal must not invite a sleep")
			}
		})
	})

	t.Run("given spawns older than the entry TTL", func(t *testing.T) {
		stale := now.Add(-SpawnEntryTTL - time.Minute)
		recorded := []time.Time{stale, stale, stale}

		t.Run("they are discarded, so a lost decrement cannot wedge the machine", func(t *testing.T) {
			if got := LiveSpawns(recorded, now); got != 0 {
				t.Fatalf("expected stale entries dropped, got %d", got)
			}
		})
	})
}

func TestParallelSpawnsPayTheWriteNotTheRead(t *testing.T) {
	t.Run("given several sub-agents launched together on a shared prefix", func(t *testing.T) {
		t.Run("every one after the first pays a write it could have read", func(t *testing.T) {
			one := ParallelSpawnCachePrice(1, 200_000)
			four := ParallelSpawnCachePrice(4, 200_000)
			if one != 0 {
				t.Fatalf("a lone spawn shares nothing; got %v", one)
			}
			if four <= 0 {
				t.Fatalf("expected a real cost for parallel spawns, got %v", four)
			}
		})
	})
}
