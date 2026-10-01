package app

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Both scenarios pin the clock rather than sleeping: the estimate is read off
// an injected now and a hand-built history, never off a real timer.

// @scenario "A queued run says roughly how long the wait is"
func TestQueuedRunSaysRoughlyHowLongTheWaitIs(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)

	t.Run("given recent history for typecheck, and a typecheck already holding the only slot", func(t *testing.T) {
		store := &fakeStore{
			heavyRuns:         1,
			heavyRunSnapshots: []HeavyRunSnapshot{{Command: "pnpm typecheck", StartedAt: now.Add(-10 * time.Second)}},
			runHistory: []domain.RunRecord{
				{Kind: domain.KindTypecheck, Duration: 30 * time.Second},
				{Kind: domain.KindTypecheck, Duration: 40 * time.Second},
				{Kind: domain.KindTypecheck, Duration: 50 * time.Second},
			},
		}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: now}

		t.Run("when another typecheck is queued behind it", func(t *testing.T) {
			reply := ask(t, gateOrch(store, sys), bashPayload("pnpm typecheck"))

			t.Run("it reports being queued behind 1 run", func(t *testing.T) {
				if !strings.Contains(reply.SystemMessage, "queued behind 1 run") {
					t.Fatalf("message = %q", reply.SystemMessage)
				}
			})

			t.Run("and it reports roughly how long that wait is", func(t *testing.T) {
				// Median 40s minus the 10s already held is 30s.
				if !strings.Contains(reply.SystemMessage, "about 30s") {
					t.Fatalf("message = %q, want a coarse estimate of about 30s", reply.SystemMessage)
				}
			})
		})
	})
}

// @scenario "With no history the gate does not guess"
func TestWithNoHistoryTheGateDoesNotGuess(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)

	t.Run("given no run of any kind has ever been recorded", func(t *testing.T) {
		store := &fakeStore{heavyRuns: 1}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: now}

		t.Run("when a run is queued behind another", func(t *testing.T) {
			reply := ask(t, gateOrch(store, sys), bashPayload("pnpm typecheck"))

			t.Run("it still reports being queued behind 1 run", func(t *testing.T) {
				if !strings.Contains(reply.SystemMessage, "queued behind 1 run") {
					t.Fatalf("message = %q", reply.SystemMessage)
				}
			})

			t.Run("and it says nothing about how long the wait might be", func(t *testing.T) {
				if reply.SystemMessage != "haven: queued behind 1 run" {
					t.Fatalf("message = %q, want exactly today's message with no guess appended", reply.SystemMessage)
				}
			})
		})
	})
}
