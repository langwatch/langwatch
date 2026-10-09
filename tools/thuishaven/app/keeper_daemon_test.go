package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const (
	keptProvisioner = 10
	keptKeeper      = 42
	keptOwner       = 77
)

// keptStackOrch is a registered stack whose keeper is keptKeeper, with a real
// plan on disk naming keptProvisioner as the up that handed it over.
func keptStackOrch(t *testing.T, owner int, alive map[int]bool, now time.Time) (*Orchestrator, *fakeStore, *fakeSystem) {
	t.Helper()
	wt := t.TempDir()
	st := domain.Stack{Slug: "feat-x", WorktreeDir: wt, LauncherPID: keptKeeper, OwnerPID: owner, PortlessDisabled: true, UpdatedAt: now}
	store := &fakeStore{stacks: []domain.Stack{st}}
	sys := &fakeSystem{alive: alive, now: now}
	o, _ := deadStackOrch(store, sys, time.Hour)
	o.cfg.KeepArgv = []string{"/bin/haven", "keep"}
	if err := writeKeeperPlan(keeperPlanPath(wt, st.Slug), KeeperPlan{ProvisionerPID: keptProvisioner, OwnerPID: owner}); err != nil {
		t.Fatal(err)
	}
	return o, store, sys
}

func lastReason(o *Orchestrator) string {
	events := o.store.ReapEvents()
	if len(events) == 0 {
		return ""
	}
	return events[len(events)-1].Reason
}

func TestDaemonSupervisesKeepers(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

	t.Run("an owner gone downs the stack and stops its keeper", func(t *testing.T) {
		o, store, sys := keptStackOrch(t, keptOwner, map[int]bool{keptKeeper: true, keptOwner: false}, now)
		o.reapDeadStacks()
		if len(store.stacks) != 0 || len(sys.terminated) != 1 || sys.terminated[0] != keptKeeper || lastReason(o) != "owner gone" {
			t.Errorf("stacks=%v terminated=%v reason=%q", store.stacks, sys.terminated, lastReason(o))
		}
	})

	t.Run("a detached stack with a live keeper is left alone", func(t *testing.T) {
		o, store, sys := keptStackOrch(t, 0, map[int]bool{keptKeeper: true}, now)
		o.reapDeadStacks()
		if len(store.stacks) != 1 || len(sys.terminated) != 0 || len(sys.spawned) != 0 {
			t.Errorf("stacks=%v terminated=%v spawned=%v", store.stacks, sys.terminated, sys.spawned)
		}
	})

	t.Run("a dead keeper is respawned from its plan, once per backoff", func(t *testing.T) {
		o, store, sys := keptStackOrch(t, keptOwner, map[int]bool{keptOwner: true}, now)
		o.reapDeadStacks()
		o.reapDeadStacks()
		if len(sys.spawned) != 1 || len(store.stacks) != 1 {
			t.Fatalf("want one respawn inside the backoff, spawned=%v stacks=%v", sys.spawned, store.stacks)
		}
		if got := sys.spawned[0].Argv; len(got) != 4 || got[2] != "feat-x" || got[3] != "--agent" {
			t.Errorf("keeper argv %v", got)
		}
		sys.now = now.Add(2 * time.Second)
		o.reapDeadStacks()
		if len(sys.spawned) != 2 {
			t.Errorf("want a second respawn after the backoff, spawned=%v", sys.spawned)
		}
	})

	t.Run("five respawns in ten minutes reap the stack as a crash loop", func(t *testing.T) {
		o, store, sys := keptStackOrch(t, 0, map[int]bool{}, now)
		for i := 0; i < keeperCrashLoop+1; i++ {
			sys.now = now.Add(time.Duration(i) * time.Minute)
			o.reapDeadStacks()
		}
		if len(sys.spawned) != keeperCrashLoop || len(store.stacks) != 0 || lastReason(o) != "keeper crash loop" {
			t.Errorf("spawned=%d stacks=%v reason=%q", len(sys.spawned), store.stacks, lastReason(o))
		}
	})

	t.Run("an up that died before its hand-over is reaped, not respawned", func(t *testing.T) {
		o, store, sys := keptStackOrch(t, 0, map[int]bool{}, now)
		store.stacks[0].LauncherPID = keptProvisioner
		o.reapDeadStacks()
		if len(sys.spawned) != 0 || len(store.stacks) != 0 || lastReason(o) != "launcher died" {
			t.Errorf("spawned=%v stacks=%v reason=%q", sys.spawned, store.stacks, lastReason(o))
		}
	})
}

// Ruling R3: a manual `haven keep` never takes a stack from a live keeper.
func TestKeepRefusesALiveKeeper(t *testing.T) {
	o, store, _ := keptStackOrch(t, 0, map[int]bool{keptKeeper: true}, time.Now())
	if err := o.Keep(context.Background(), "feat-x", KeeperPlan{ProvisionerPID: keptProvisioner}); err == nil {
		t.Fatal("Keep took over a live keeper")
	}
	if store.stacks[0].LauncherPID != keptKeeper {
		t.Errorf("the record changed hands: %+v", store.stacks[0])
	}
}

// Ruling R4: Ctrl-C during the hand-over returns at once.
func TestAwaitKeeperReturnsOnCancel(t *testing.T) {
	o, _, _ := keptStackOrch(t, 0, map[int]bool{}, time.Now())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	if err := o.awaitKeeper(ctx, "feat-x", keptProvisioner); err == nil || time.Since(start) > time.Second {
		t.Errorf("err=%v after %s", err, time.Since(start))
	}
}

// An up that clears a dead keeper's record takes its plan (and an S4b copy in
// the log dir) with it, so the daemon never respawns that keeper from it.
func TestUpClearingADeadKeeperRemovesItsPlan(t *testing.T) {
	o, store, _ := keptStackOrch(t, 0, map[int]bool{}, time.Now())
	wt := store.stacks[0].WorktreeDir
	store.slugCache = map[string]string{wt: "feat-x"}
	logDir, _ := domain.StackLogPaths(wt, "feat-x")
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(logDir, "plan.json")
	if err := os.WriteFile(legacy, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if proceed, err := o.reconcileRunningStack(UpParams{WorktreeDir: wt, IsLinkedWorktree: true}, PlanOptions{}); err != nil || !proceed {
		t.Fatalf("proceed=%v err=%v", proceed, err)
	}
	for _, p := range []string{filepath.Dir(keeperPlanPath(wt, "feat-x")), legacy} {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			t.Errorf("%s outlived the dead keeper's record (err=%v)", p, err)
		}
	}
}

// @scenario "The daemon starts a keeper only for a stack waiting to be handed over"
func TestStartKeeperOnlyForAStackMidHandOver(t *testing.T) {
	t.Run("a stack a live keeper already holds", func(t *testing.T) {
		o, _, sys := keptStackOrch(t, 0, map[int]bool{keptKeeper: true, keptProvisioner: true}, time.Now())
		if err := o.StartKeeper(context.Background(), "feat-x"); err == nil || len(sys.spawned) != 0 {
			t.Errorf("err=%v spawned=%v", err, sys.spawned)
		}
	})

	t.Run("a provisioner that died before asking", func(t *testing.T) {
		o, store, sys := keptStackOrch(t, 0, map[int]bool{}, time.Now())
		store.stacks[0].LauncherPID = keptProvisioner
		if err := o.StartKeeper(context.Background(), "feat-x"); err == nil || len(sys.spawned) != 0 {
			t.Errorf("err=%v spawned=%v", err, sys.spawned)
		}
	})

	t.Run("a stack with no plan", func(t *testing.T) {
		o, store, sys := keptStackOrch(t, 0, map[int]bool{keptProvisioner: true}, time.Now())
		store.stacks[0].LauncherPID = keptProvisioner
		removeKeeperPlan(store.stacks[0].WorktreeDir, "feat-x")
		if err := o.StartKeeper(context.Background(), "feat-x"); err == nil || len(sys.spawned) != 0 {
			t.Errorf("err=%v spawned=%v", err, sys.spawned)
		}
	})
}
