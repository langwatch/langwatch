package domain

import (
	"strings"
	"testing"
	"time"
)

func TestNewRetryHintNeverQuotesBeyondTheCacheWindow(t *testing.T) {
	t.Run("given a sub-agent, which holds the five-minute cache", func(t *testing.T) {
		t.Run("when the queue is shallow enough to quote", func(t *testing.T) {
			hint, ok := NewRetryHint(2, 30*time.Second, SubAgent)

			t.Run("a hint is issued", func(t *testing.T) {
				if !ok {
					t.Fatal("expected a hint for a one-minute wait")
				}
				if hint.Position != 2 || hint.RetryAfter != time.Minute {
					t.Fatalf("expected position 2 and a minute, got %d and %s", hint.Position, hint.RetryAfter)
				}
			})

			t.Run("and it sits inside the window the caller is in", func(t *testing.T) {
				if !hint.WithinWindow(SubAgent) {
					t.Fatalf("%s must be under the %s ceiling and the %s floor",
						hint.RetryAfter, SubAgent.WaitCeiling(), SubAgent.CacheFloor())
				}
			})
		})

		t.Run("when the queue is deeper than the window", func(t *testing.T) {
			t.Run("no hint is issued, rather than a comfortable lie", func(t *testing.T) {
				if _, ok := NewRetryHint(20, time.Minute, SubAgent); ok {
					t.Fatal("a twenty-minute wait must not be quoted to a five-minute cache")
				}
			})
		})
	})

	t.Run("given a main session, which can afford much longer", func(t *testing.T) {
		t.Run("the same wait that was unquotable to a sub-agent is quotable here", func(t *testing.T) {
			hint, ok := NewRetryHint(20, time.Minute, MainSession)
			if !ok {
				t.Fatal("twenty minutes fits inside a main session's ceiling")
			}
			if !hint.WithinWindow(MainSession) {
				t.Fatal("the invariant must hold for every caller kind, not just the tight one")
			}
		})
	})

	t.Run("given a command with nothing observed", func(t *testing.T) {
		t.Run("no estimate is invented", func(t *testing.T) {
			if _, ok := NewRetryHint(3, 0, SubAgent); ok {
				t.Fatal("an unobserved command has no honest estimate")
			}
			if _, ok := EstimateWait(0, time.Minute); ok {
				t.Fatal("position zero is not a place in a queue")
			}
		})
	})
}

func TestRetryHintDescribesTheWaitFirst(t *testing.T) {
	t.Run("given a hint bound for a refusal reason", func(t *testing.T) {
		hint := RetryHint{Position: 4, RetryAfter: 90 * time.Second}
		got := hint.Describe()

		t.Run("it leads with the wait, which is what decides what the caller does next", func(t *testing.T) {
			if !strings.HasPrefix(got, "try again in about") {
				t.Fatalf("expected the wait first, got %q", got)
			}
		})

		t.Run("and still names the position", func(t *testing.T) {
			if !strings.Contains(got, "position 4") {
				t.Fatalf("expected the position, got %q", got)
			}
		})
	})
}

func TestStarvationIsMeasuredBeforeItIsSolved(t *testing.T) {
	t.Run("given a caller refused once or twice", func(t *testing.T) {
		t.Run("that is bad luck, not starvation", func(t *testing.T) {
			if Starving(1) || Starving(StarvationThreshold-1) {
				t.Fatal("a couple of refusals must not trip the counter")
			}
		})
	})

	t.Run("given a caller refused repeatedly while others are served", func(t *testing.T) {
		t.Run("the counter says so, which is what would justify holding its place", func(t *testing.T) {
			if !Starving(StarvationThreshold) {
				t.Fatal("expected the threshold to trip")
			}
		})
	})
}
