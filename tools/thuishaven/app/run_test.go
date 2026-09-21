package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// runOrch builds an orchestrator for one gated run. The machine is given enough
// memory that a slot is always free, so these tests are about what happens to a
// run rather than about waiting for one.
func runOrch(store *fakeStore, sup *fakeSupervisor) *Orchestrator {
	return &Orchestrator{
		store: store,
		sup:   sup,
		sys:   &fakeSystem{memStat: domain.MemStat{TotalBytes: 64 << 30}, now: time.Now()},
		log:   zap.NewNop(),
	}
}

// @scenario "A run that failed is not evidence of how long it takes"
func TestOnlyACompletedRunIsTimed(t *testing.T) {
	t.Run("given a unit run that fails after a moment", func(t *testing.T) {
		store := &fakeStore{}
		sup := &fakeSupervisor{err: errors.New("suite died")}

		t.Run("when it finishes", func(t *testing.T) {
			err := runOrch(store, sup).RunHeavy(context.Background(),
				HeavyRun{Shell: "pnpm test:unit run src/x"})

			t.Run("the failure is returned", func(t *testing.T) {
				if err == nil {
					t.Fatal("expected the run's own error")
				}
			})

			t.Run("and nothing is filed against the command's timing", func(t *testing.T) {
				// A suite that died after two seconds would otherwise read as a
				// two-second suite, and the next caller is narrowed on the
				// strength of a crash.
				if got := store.ObservedDuration("unit"); got != 0 {
					t.Fatalf("a crash is not a duration; got %s", got)
				}
			})
		})
	})

	t.Run("given the same run succeeding", func(t *testing.T) {
		store := &fakeStore{}
		sup := &fakeSupervisor{}

		t.Run("its duration is recorded, because that is what the next decision reads", func(t *testing.T) {
			if err := runOrch(store, sup).RunHeavy(context.Background(),
				HeavyRun{Shell: "pnpm test:unit run src/x"}); err != nil {
				t.Fatal(err)
			}
			if _, ok := store.observed["unit"]; !ok {
				t.Fatalf("expected an observation under the unit key, got %v", store.observed)
			}
		})
	})
}

// @scenario "A narrowed run is actually run at the narrower width"
func TestNarrowedWidthReachesTheRun(t *testing.T) {
	t.Run("given a run the gate admitted at two workers", func(t *testing.T) {
		store := &fakeStore{}
		sup := &fakeSupervisor{}

		t.Run("when it runs", func(t *testing.T) {
			if err := runOrch(store, sup).RunHeavy(context.Background(),
				HeavyRun{Shell: "pnpm test:unit run src/x", Workers: 2}); err != nil {
				t.Fatal(err)
			}

			t.Run("the width is applied to its environment", func(t *testing.T) {
				if !strings.Contains(strings.Join(sup.envs[0], " "), "VITEST_MAX_WORKERS=2") {
					t.Fatalf("the narrowing never reached the suite: %v", sup.envs[0])
				}
			})

			t.Run("and the command itself is left exactly as the caller wrote it", func(t *testing.T) {
				if sup.shells[0] != "pnpm test:unit run src/x" {
					t.Fatalf("the command was rewritten rather than configured: %q", sup.shells[0])
				}
			})
		})
	})

	t.Run("given a run that was not narrowed", func(t *testing.T) {
		store := &fakeStore{}
		sup := &fakeSupervisor{}

		t.Run("no width is imposed, so the suite keeps whatever its config chose", func(t *testing.T) {
			if err := runOrch(store, sup).RunHeavy(context.Background(),
				HeavyRun{Shell: "pnpm test:unit run src/x"}); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(strings.Join(sup.envs[0], " "), "VITEST_MAX_WORKERS") {
				t.Fatalf("an unnarrowed run must not be capped: %v", sup.envs[0])
			}
		})
	})
}
