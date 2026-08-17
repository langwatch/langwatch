package lifecycle

import (
	"context"
	"testing"
	"time"
)

// Every caller computes the graceful budget from config —
// WithGraceful(time.Duration(cfg.Server.GracefulSeconds) * time.Second) — so a
// GracefulSeconds that is unset, or zero from a config path that forgot its own
// default, reaches this option as 0.
//
// That must not mean "no budget". A zero budget hands the stop phase a context
// that is already expired, so every Stop returns DeadlineExceeded immediately,
// nothing drains, and the shutdown still reports itself complete — the worst
// possible combination. The default has to stand instead.
//
// @scenario "A zero graceful budget falls back to the default"
func TestWithGraceful_ignores_a_non_positive_budget(t *testing.T) {
	for _, d := range []time.Duration{0, -1 * time.Second} {
		g := New(WithGraceful(d))
		if g.graceful != defaultGraceful {
			t.Errorf("WithGraceful(%v): graceful = %v, want the default %v", d, g.graceful, defaultGraceful)
		}
	}
}

func TestWithGraceful_accepts_a_positive_budget(t *testing.T) {
	g := New(WithGraceful(42 * time.Second))
	if g.graceful != 42*time.Second {
		t.Errorf("graceful = %v, want 42s", g.graceful)
	}
}

// A zero drain delay stays honored: it is a documented, explicit "do not wait"
// for a service with nothing in front of it, unlike a zero graceful budget which
// is only ever a mistake.
//
// @scenario "An explicit zero drain delay is honored"
func TestWithDrainDelay_honors_an_explicit_zero(t *testing.T) {
	g := New(WithDrainDelay(0))
	if g.drainDelay != 0 {
		t.Errorf("drainDelay = %v, want an explicit 0 to be kept", g.drainDelay)
	}
}

// The whole point of refusing a zero budget: a service that waits on ctx.Done()
// still gets a real deadline rather than an already-expired one, so it drains
// instead of returning instantly.
func TestGroup_zero_configured_budget_still_drains(t *testing.T) {
	var sawDeadline bool
	svc := &mockSvc{
		name:    "drainer",
		startFn: func(context.Context) error { return nil },
		stopFn: func(ctx context.Context) error {
			if dl, ok := ctx.Deadline(); ok && time.Until(dl) > 0 {
				sawDeadline = true
			}
			return nil
		},
	}

	// Zero, as a misconfigured service would pass it.
	g := New(WithGraceful(0), WithDrainDelay(0))
	g.Add(svc)

	ctx, cancel := context.WithCancel(nopCtx())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	if err := g.Run(ctx); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !sawDeadline {
		t.Error("Stop saw no remaining time; a zero configured budget expired the stop context")
	}
}
