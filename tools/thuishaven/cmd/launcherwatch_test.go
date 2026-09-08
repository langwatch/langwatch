package cmd

import (
	"context"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

// The foreground up watches the group it was launched into, and only that
// shape: an interactive job leads its own group, the detached child runs
// under Setsid, and both must resolve to "nothing to watch".
//
// @scenario "A run that leads its own process group watches nothing"
func TestGroupLeaderToWatch(t *testing.T) {
	alive := func(int) bool { return true }
	dead := func(int) bool { return false }

	t.Run("given a run that leads its own process group", func(t *testing.T) {
		if got := groupLeaderToWatch(42, 42, alive); got != 0 {
			t.Fatalf("own group leader must watch nothing, got %d", got)
		}
	})
	t.Run("given a degenerate group id", func(t *testing.T) {
		if got := groupLeaderToWatch(42, 0, alive); got != 0 {
			t.Fatalf("pgid 0 must watch nothing, got %d", got)
		}
		if got := groupLeaderToWatch(42, 1, alive); got != 0 {
			t.Fatalf("pgid 1 must watch nothing, got %d", got)
		}
	})
	t.Run("given a leader that is already gone", func(t *testing.T) {
		if got := groupLeaderToWatch(42, 99, dead); got != 0 {
			t.Fatalf("a dead leader leaves nothing to observe, got %d", got)
		}
	})
	t.Run("given a live leader above this run", func(t *testing.T) {
		if got := groupLeaderToWatch(42, 99, alive); got != 99 {
			t.Fatalf("a live foreign leader is the one to watch, got %d", got)
		}
	})
}

// @scenario "A foreground up goes down with the group that launched it"
func TestWatchProcessGone(t *testing.T) {
	t.Run("given a watched leader that dies", func(t *testing.T) {
		var leaderAlive atomic.Bool
		leaderAlive.Store(true)
		gone := make(chan struct{})

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		go watchProcessGone(ctx, processWatch{
			pid:    99,
			every:  time.Millisecond,
			alive:  func(int) bool { return leaderAlive.Load() },
			onGone: func() { close(gone) },
		})

		t.Run("when the leader is gone", func(t *testing.T) {
			leaderAlive.Store(false)
			select {
			case <-gone:
			case <-ctx.Done():
				t.Fatal("the watch never noticed the leader dying")
			}
		})
	})

	t.Run("given a run that ends while its leader lives", func(t *testing.T) {
		fired := make(chan struct{})
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			watchProcessGone(ctx, processWatch{
				pid:    99,
				every:  time.Millisecond,
				alive:  func(int) bool { return true },
				onGone: func() { close(fired) },
			})
			close(done)
		}()

		t.Run("when the run's context ends", func(t *testing.T) {
			cancel()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("the watch did not stop with the run")
			}
			select {
			case <-fired:
				t.Fatal("a finished run is not a dead leader")
			default:
			}
		})
	})
}

// processAlive is the one real syscall in the watch; prove both answers.
func TestProcessAlive(t *testing.T) {
	t.Run("given this test's own process", func(t *testing.T) {
		if !processAlive(os.Getpid()) {
			t.Fatal("our own pid must read as alive")
		}
	})
	t.Run("given a pid that cannot exist", func(t *testing.T) {
		if processAlive(1<<30 + 7) {
			t.Fatal("an absurd pid must read as gone")
		}
	})
}
