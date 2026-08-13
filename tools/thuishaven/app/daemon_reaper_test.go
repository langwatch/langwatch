package app

import (
	"context"
	"testing"
	"time"

	"go.uber.org/zap"
)

type fakeJanitor struct {
	cutoffs []time.Time
	names   []string
}

func (f *fakeJanitor) ReapTestContainers(_ context.Context, cutoff time.Time) ([]string, error) {
	f.cutoffs = append(f.cutoffs, cutoff)
	return f.names, nil
}

func reaperOrch(janitor ContainerJanitor, ttl time.Duration, now time.Time) *Orchestrator {
	return &Orchestrator{
		cfg:     Config{TestContainerTTL: ttl},
		sys:     &fakeSystem{now: now},
		janitor: janitor,
		log:     zap.NewNop(),
	}
}

// @scenario "A test container past the grace period is removed"
func TestDaemonSweepsWithTheConfiguredGracePeriod(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)

	t.Run("given a one-hour grace period", func(t *testing.T) {
		janitor := &fakeJanitor{names: []string{"lucid_goodall"}}
		o := reaperOrch(janitor, time.Hour, now)

		t.Run("when the daemon runs its background hygiene", func(t *testing.T) {
			o.reapTestContainers(context.Background())

			t.Run("the janitor is asked to reap everything older than the period", func(t *testing.T) {
				if len(janitor.cutoffs) != 1 {
					t.Fatalf("expected one sweep, got %d", len(janitor.cutoffs))
				}
				if got, want := janitor.cutoffs[0], now.Add(-time.Hour); !got.Equal(want) {
					t.Fatalf("cutoff = %v, want %v", got, want)
				}
			})
		})
	})
}

// @scenario "The operator can disable the sweep"
func TestDaemonSkipsTheSweepWhenDisabled(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)

	t.Run("given a zero grace period", func(t *testing.T) {
		janitor := &fakeJanitor{}
		o := reaperOrch(janitor, 0, now)

		t.Run("when the daemon runs its background hygiene", func(t *testing.T) {
			o.reapTestContainers(context.Background())

			if len(janitor.cutoffs) != 0 {
				t.Fatalf("expected no sweep at all, got %d", len(janitor.cutoffs))
			}
		})
	})

	t.Run("given no janitor is wired at all", func(t *testing.T) {
		o := reaperOrch(nil, time.Hour, now)
		o.reapTestContainers(context.Background()) // must not panic
	})
}
