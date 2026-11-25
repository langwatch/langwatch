package app

import (
	"context"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// identityStack is a registered stack whose launcher pid 42 started at "then".
func identityStack() domain.Stack {
	s := droppedStack(42)
	s.LauncherStart = "Thu Oct  9 10:00:00 2026"
	return s
}

// A pid is ours only while its start time still matches the record (D6). A
// reused pid belongs to a stranger: haven treats the stack as dead and never
// signals the stranger, whatever the reap or governance path.
func TestLauncherIdentityFollowsStartTime(t *testing.T) {
	now := time.Date(2026, 8, 25, 12, 0, 30, 0, time.UTC)

	cases := []struct {
		name  string
		start string
		ours  bool
	}{
		{"the recorded start matches", "Thu Oct  9 10:00:00 2026", true},
		{"the pid was reused by a stranger", "Fri Oct 10 08:00:00 2026", false},
		{"ps cannot read a start, liveness stands", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sys := &fakeSystem{alive: map[int]bool{42: true}, starts: map[int]string{42: c.start}, now: now}
			o, _ := deadStackOrch(&fakeStore{}, sys, time.Hour)
			if got := o.launcherIsOurs(identityStack()); got != c.ours {
				t.Fatalf("launcherIsOurs = %v, want %v", got, c.ours)
			}
		})
	}

	t.Run("a record written before start times existed falls back to liveness", func(t *testing.T) {
		sys := &fakeSystem{alive: map[int]bool{42: true}, starts: map[int]string{42: "anything"}, now: now}
		o, _ := deadStackOrch(&fakeStore{}, sys, time.Hour)
		if !o.launcherIsOurs(droppedStack(42)) {
			t.Fatal("a legacy record with a live launcher must stay ours")
		}
	})

	t.Run("given a stack whose launcher pid now belongs to a stranger", func(t *testing.T) {
		stranger := func() (*fakeStore, *fakeSystem, *Orchestrator) {
			stale := identityStack()
			stale.UpdatedAt = now.Add(-2 * time.Hour) // stale too, so a timed-out reap would signal
			store := &fakeStore{stacks: []domain.Stack{stale}}
			sys := &fakeSystem{alive: map[int]bool{42: true}, starts: map[int]string{42: "Fri Oct 10 08:00:00 2026"}, now: now}
			o, _ := deadStackOrch(store, sys, time.Hour)
			return store, sys, o
		}

		t.Run("the reaper drops the entry and never signals the stranger", func(t *testing.T) {
			store, sys, o := stranger()
			o.reapDeadStacks()
			if len(store.stacks) != 0 {
				t.Errorf("the stack was left registered: %v", store.stacks)
			}
			if len(sys.terminated) != 0 {
				t.Errorf("the stranger was signaled: %v", sys.terminated)
			}
		})

		t.Run("governance neither demotes nor restores it", func(t *testing.T) {
			store, sys, o := stranger()
			other := domain.Stack{Slug: "focused", LauncherPID: 7}
			o.demoteUnfocused([]domain.Stack{other, store.stacks[0]})
			o.restoreDemoted(store.stacks)
			if len(sys.demoted)+len(sys.restored) != 0 {
				t.Errorf("stranger group signaled: demoted %v restored %v", sys.demoted, sys.restored)
			}
		})

		t.Run("stopping it from the hub sends no signal", func(t *testing.T) {
			_, sys, o := stranger()
			_ = o.DownStack(context.Background(), "feat-x")
			if len(sys.terminated) != 0 {
				t.Errorf("the stranger was signaled: %v", sys.terminated)
			}
		})
	})
}
