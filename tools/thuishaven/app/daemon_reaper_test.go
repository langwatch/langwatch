package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.uber.org/zap"
)

type fakeJanitor struct {
	stoppedCutoffs []time.Time
	runningCutoffs []time.Time
	names          []string
	err            error
}

func (f *fakeJanitor) ReapTestContainers(_ context.Context, stoppedCutoff, runningCutoff time.Time) ([]string, error) {
	f.stoppedCutoffs = append(f.stoppedCutoffs, stoppedCutoff)
	f.runningCutoffs = append(f.runningCutoffs, runningCutoff)
	return f.names, f.err
}

func reaperOrch(janitor ContainerJanitor, ttl, runningTTL time.Duration, now time.Time) *Orchestrator {
	return &Orchestrator{
		cfg:     Config{TestContainerTTL: ttl, RunningTestContainerTTL: runningTTL},
		sys:     &fakeSystem{now: now},
		janitor: janitor,
		store:   &fakeStore{},
		log:     zap.NewNop(),
	}
}

func TestDaemonSweepsWithTheConfiguredGracePeriod(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)

	t.Run("given a one-hour stopped and four-hour running grace period", func(t *testing.T) {
		janitor := &fakeJanitor{names: []string{"lucid_goodall"}}
		o := reaperOrch(janitor, time.Hour, 4*time.Hour, now)

		t.Run("when the daemon runs its background hygiene", func(t *testing.T) {
			o.reapTestContainers(context.Background())

			t.Run("the janitor gets both cutoffs, running the more lenient", func(t *testing.T) {
				if len(janitor.stoppedCutoffs) != 1 {
					t.Fatalf("expected one sweep, got %d", len(janitor.stoppedCutoffs))
				}
				if got, want := janitor.stoppedCutoffs[0], now.Add(-time.Hour); !got.Equal(want) {
					t.Fatalf("stopped cutoff = %v, want %v", got, want)
				}
				if got, want := janitor.runningCutoffs[0], now.Add(-4*time.Hour); !got.Equal(want) {
					t.Fatalf("running cutoff = %v, want %v", got, want)
				}
			})

			t.Run("the reap lands in the record the hub reads", func(t *testing.T) {
				events := o.store.ReapEvents()
				if len(events) != 1 {
					t.Fatalf("expected one recorded reap, got %d", len(events))
				}
				if events[0].Kind != "testcontainer" || events[0].Target != "lucid_goodall" {
					t.Errorf("recorded event should name what was reaped, got %+v", events[0])
				}
			})
		})
	})

	t.Run("given a running TTL shorter than the stopped one", func(t *testing.T) {
		janitor := &fakeJanitor{}
		o := reaperOrch(janitor, time.Hour, time.Minute, now)

		t.Run("when the daemon runs its background hygiene", func(t *testing.T) {
			o.reapTestContainers(context.Background())

			t.Run("the running cutoff is clamped to the stopped TTL", func(t *testing.T) {
				if got, want := janitor.runningCutoffs[0], now.Add(-time.Hour); !got.Equal(want) {
					t.Fatalf("running cutoff = %v, want the clamped %v", got, want)
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
		o := reaperOrch(janitor, 0, time.Hour, now)

		t.Run("when the daemon runs its background hygiene", func(t *testing.T) {
			o.reapTestContainers(context.Background())

			if len(janitor.stoppedCutoffs) != 0 {
				t.Fatalf("expected no sweep at all, got %d", len(janitor.stoppedCutoffs))
			}
		})
	})

	t.Run("given no janitor is wired at all", func(t *testing.T) {
		o := reaperOrch(nil, time.Hour, time.Hour, now)
		o.reapTestContainers(context.Background()) // must not panic
	})
}

func TestDaemonSurvivesAFailingSweep(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)

	t.Run("given the janitor reports a docker failure", func(t *testing.T) {
		janitor := &fakeJanitor{err: errors.New("docker exploded")}
		o := reaperOrch(janitor, time.Hour, time.Hour, now)

		t.Run("when the daemon runs its background hygiene", func(t *testing.T) {
			o.reapTestContainers(context.Background()) // must not panic; failure is a warn, not a crash

			if len(janitor.stoppedCutoffs) != 1 {
				t.Fatalf("expected the sweep to have been attempted once, got %d", len(janitor.stoppedCutoffs))
			}
		})
	})
}
