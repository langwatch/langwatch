package app

import (
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const testGiB = uint64(1) << 30

// governorOrch wires the smallest orchestrator governPressure needs.
func governorOrch(store *fakeStore, sys *fakeSystem) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming("")},
		store: store, sys: sys, proxy: &fakeProxy{},
		log: zap.NewNop(),
	}
}

// twoStacks returns a focused stack (most recently updated, so first) and an
// unfocused one behind it, both live.
func twoStacks() (*fakeStore, *fakeSystem) {
	store := &fakeStore{stacks: []domain.Stack{
		{Slug: "focused", LauncherPID: 100},
		{Slug: "background", LauncherPID: 200},
	}}
	sys := &fakeSystem{alive: map[int]bool{100: true, 200: true}, now: time.Now()}
	return store, sys
}

// @scenario "The reading is published for other processes to read"
func TestGovernorPublishesItsReading(t *testing.T) {
	t.Run("given a machine under pressure", func(t *testing.T) {
		store, sys := twoStacks()
		sys.memStat = domain.MemStat{TotalBytes: 18 * testGiB, CompressedBytes: 2 * testGiB}

		t.Run("when the daemon completes a tick", func(t *testing.T) {
			governorOrch(store, sys).governPressure()

			t.Run("the current level is written with a version and a timestamp", func(t *testing.T) {
				rec, ok := store.ReadPressure()
				if !ok {
					t.Fatal("expected a published record")
				}
				if rec.Version != domain.PressureRecordVersion {
					t.Fatalf("expected the current version, got %d", rec.Version)
				}
				if rec.Level != domain.Amber.String() {
					t.Fatalf("expected amber, got %q", rec.Level)
				}
				if rec.WrittenAt.IsZero() {
					t.Fatal("expected a timestamp readers can age out")
				}
			})
		})
	})
}

// @scenario "Under pressure the unfocused stacks are demoted"
// @scenario "Demotion is lifted when pressure clears"
func TestGovernorDemotesEveryStackButTheFocusedOne(t *testing.T) {
	t.Run("given several stacks are running and one worktree is focused", func(t *testing.T) {
		t.Run("when pressure reaches amber", func(t *testing.T) {
			store, sys := twoStacks()
			sys.memStat = domain.MemStat{TotalBytes: 18 * testGiB, CompressedBytes: 2 * testGiB}
			governorOrch(store, sys).governPressure()

			t.Run("the unfocused stack is moved into the background band", func(t *testing.T) {
				if len(sys.demoted) != 1 || sys.demoted[0] != 200 {
					t.Fatalf("expected only the unfocused launcher demoted, got %v", sys.demoted)
				}
			})

			t.Run("and the focused one is left alone, because it is what is being watched", func(t *testing.T) {
				for _, pid := range sys.demoted {
					if pid == 100 {
						t.Fatal("the focused stack must not be demoted")
					}
				}
			})

			t.Run("and nothing is stopped, because demotion is reversible and losing work is not", func(t *testing.T) {
				if len(sys.terminated) != 0 || len(sys.groupKilled) != 0 {
					t.Fatalf("expected no kills, got terminated=%v killed=%v", sys.terminated, sys.groupKilled)
				}
			})
		})

		t.Run("when pressure returns to green", func(t *testing.T) {
			store, sys := twoStacks()
			sys.memStat = domain.MemStat{TotalBytes: 18 * testGiB}
			governorOrch(store, sys).governPressure()

			t.Run("every stack is restored to the normal band", func(t *testing.T) {
				if len(sys.restored) != 2 {
					t.Fatalf("expected both launchers restored, got %v", sys.restored)
				}
			})

			t.Run("and none is demoted", func(t *testing.T) {
				if len(sys.demoted) != 0 {
					t.Fatalf("expected no demotions on an unloaded machine, got %v", sys.demoted)
				}
			})
		})
	})
}

// @scenario "At critical pressure the daemon names the worst offender but does not act on it"
func TestGovernorNamesTheWorstOffenderWithoutStoppingIt(t *testing.T) {
	t.Run("given pressure is red", func(t *testing.T) {
		store, sys := twoStacks()
		sys.memStat = domain.MemStat{
			TotalBytes: 18 * testGiB, SwapUsedBytes: 3900 * (1 << 20), SwapTotalBytes: 4 * testGiB,
		}

		t.Run("when the daemon completes a tick", func(t *testing.T) {
			governorOrch(store, sys).governPressure()

			t.Run("it does not stop anything, because it did not start that work", func(t *testing.T) {
				if len(sys.terminated) != 0 || len(sys.groupKilled) != 0 {
					t.Fatalf("red must name, not act; got terminated=%v killed=%v", sys.terminated, sys.groupKilled)
				}
			})

			t.Run("and the level published is red", func(t *testing.T) {
				rec, _ := store.ReadPressure()
				if rec.Level != domain.Red.String() {
					t.Fatalf("expected red, got %q", rec.Level)
				}
			})
		})
	})
}

// @scenario "Orphaned test workers are swept"
func TestGovernorSweepsOrphanedTestWorkers(t *testing.T) {
	t.Run("given a vitest worker process whose parent is PID 1", func(t *testing.T) {
		store, sys := twoStacks()
		sys.orphans = []int{4242}

		t.Run("when the daemon completes a tick", func(t *testing.T) {
			governorOrch(store, sys).governPressure()

			t.Run("that worker is reclaimed", func(t *testing.T) {
				if len(sys.groupKilled) != 1 || sys.groupKilled[0] != 4242 {
					t.Fatalf("expected the orphan reclaimed, got %v", sys.groupKilled)
				}
			})
		})
	})

	t.Run("given no orphans", func(t *testing.T) {
		store, sys := twoStacks()

		t.Run("nothing is reclaimed, because a worker with a live parent is not ours to take", func(t *testing.T) {
			governorOrch(store, sys).governPressure()
			if len(sys.groupKilled) != 0 {
				t.Fatalf("expected no kills, got %v", sys.groupKilled)
			}
		})
	})
}

// @scenario "Focus that cannot be determined demotes nothing"
func TestGovernorDemotesNothingWithoutStacks(t *testing.T) {
	t.Run("given no stacks are registered, so no worktree is focused", func(t *testing.T) {
		store := &fakeStore{}
		sys := &fakeSystem{alive: map[int]bool{}, now: time.Now()}
		sys.memStat = domain.MemStat{TotalBytes: 18 * testGiB, CompressedBytes: 2 * testGiB}

		t.Run("when pressure reaches amber", func(t *testing.T) {
			governorOrch(store, sys).governPressure()

			t.Run("nothing is demoted", func(t *testing.T) {
				if len(sys.demoted) != 0 {
					t.Fatalf("expected no demotions, got %v", sys.demoted)
				}
			})

			t.Run("but the reading is still published, so callers are not blinded", func(t *testing.T) {
				if _, ok := store.ReadPressure(); !ok {
					t.Fatal("expected the level published even with no stacks")
				}
			})
		})
	})
}
