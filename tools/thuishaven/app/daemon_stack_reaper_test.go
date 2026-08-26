package app

import (
	"slices"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// deadStackOrch wires the daemon's stack reaper over recording fakes.
func deadStackOrch(store *fakeStore, sys *fakeSystem, idleTTL time.Duration) (*Orchestrator, *fakeProxy) {
	proxy := &fakeProxy{}
	return &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming(""), IdleTTL: idleTTL},
		store: store, sys: sys, proxy: proxy, log: zap.NewNop(),
	}, proxy
}

// droppedStack is a stack the machine lost: an external OOM kill took the
// launcher, and only the registry entry and the routes are left. Its persisted
// service list is deliberately shorter than the set of hostnames it registered
// — the shape a stack that died mid-provision leaves behind.
func droppedStack(pid int) domain.Stack {
	return domain.Stack{
		Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: pid,
		Services:  []domain.Service{{Name: "app", Port: 9000}},
		UpdatedAt: time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC),
	}
}

// @scenario "A stack whose launcher died gives its hostnames up"
func TestDaemonReapsStacksWhoseLauncherIsGone(t *testing.T) {
	now := time.Date(2026, 8, 25, 12, 0, 30, 0, time.UTC)

	t.Run("given a registered stack whose launcher was killed", func(t *testing.T) {
		newFixture := func() (*fakeStore, *Orchestrator, *fakeProxy) {
			store := &fakeStore{stacks: []domain.Stack{droppedStack(42)}}
			sys := &fakeSystem{alive: map[int]bool{42: false}, now: now}
			o, proxy := deadStackOrch(store, sys, time.Hour)
			return store, o, proxy
		}

		t.Run("when the daemon ticks, every hostname it could own is deregistered", func(t *testing.T) {
			_, o, proxy := newFixture()

			o.reapDeadStacks()

			// The union, not just what the stack persisted: a name left behind
			// keeps resolving to a loopback port the kernel has since handed to
			// an unrelated worktree, which answers 404 instead of refusing.
			want := []string{"app.feat-x", "gateway.feat-x", "nlp.feat-x", "langyagent.feat-x", "clickhouse.feat-x", "postgres.feat-x"}
			for _, route := range want {
				if !slices.Contains(proxy.removed, route) {
					t.Errorf("route %q was left pointing at a dead stack (removed: %v)", route, proxy.removed)
				}
			}
		})

		t.Run("when the daemon ticks, the registry entry goes with the routes", func(t *testing.T) {
			store, o, _ := newFixture()

			o.reapDeadStacks()

			if len(store.stacks) != 0 {
				t.Errorf("the dead stack must be dropped, got %v", store.stacks)
			}
			events := o.store.ReapEvents()
			if len(events) != 1 || events[0].Target != "feat-x" || events[0].Reason != "launcher died" {
				t.Errorf("the reap must be recorded for the hub feed, got %+v", events)
			}
		})

		// haven never respawns a stack it did not start. `haven up` is the
		// recovery, so the daemon must not signal or adopt anything here.
		t.Run("when the daemon ticks, it never tries to restart or signal the stack", func(t *testing.T) {
			_, o, _ := newFixture()

			o.reapDeadStacks()

			sys := o.sys.(*fakeSystem)
			if len(sys.terminated) != 0 || len(sys.groupKilled) != 0 {
				t.Errorf("a dead launcher needs no signal, got terminated=%v killed=%v", sys.terminated, sys.groupKilled)
			}
		})
	})

	t.Run("given a live stack with a fresh heartbeat", func(t *testing.T) {
		t.Run("when the daemon ticks, nothing is deregistered", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{droppedStack(42)}}
			store.stacks[0].UpdatedAt = now
			sys := &fakeSystem{alive: map[int]bool{42: true}, now: now}
			o, proxy := deadStackOrch(store, sys, time.Hour)

			o.reapDeadStacks()

			if len(proxy.removed) != 0 || len(store.stacks) != 1 {
				t.Errorf("a live stack must be left alone, removed=%v stacks=%v", proxy.removed, store.stacks)
			}
		})
	})

	t.Run("given a live launcher whose heartbeat went stale past the idle TTL", func(t *testing.T) {
		t.Run("when the daemon ticks, the launcher is stopped and the routes go", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{droppedStack(42)}}
			sys := &fakeSystem{alive: map[int]bool{42: true}, now: now}
			o, proxy := deadStackOrch(store, sys, time.Second)

			o.reapDeadStacks()

			if len(sys.terminated) != 1 || sys.terminated[0] != 42 {
				t.Errorf("a stale launcher stops its own children first, got %v", sys.terminated)
			}
			if !slices.Contains(proxy.removed, "app.feat-x") {
				t.Errorf("the routes must go with the stack, got %v", proxy.removed)
			}
		})
	})

	t.Run("given a stack provisioned with PORTLESS=0", func(t *testing.T) {
		t.Run("when the daemon ticks, no route is touched because it never had any", func(t *testing.T) {
			st := droppedStack(42)
			st.PortlessDisabled = true
			store := &fakeStore{stacks: []domain.Stack{st}}
			sys := &fakeSystem{alive: map[int]bool{42: false}, now: now}
			o, proxy := deadStackOrch(store, sys, time.Hour)

			o.reapDeadStacks()

			if len(proxy.removed) != 0 {
				t.Errorf("a bypassed stack registers no hostnames, got %v", proxy.removed)
			}
			if len(store.stacks) != 0 {
				t.Errorf("the entry must still be dropped, got %v", store.stacks)
			}
		})
	})
}

// `up` cleans a dead launcher's entry so it never blocks provisioning. Until
// now it dropped the entry and left the routes, which is the state the incident
// found: no stack on record, hostnames still resolving to a stranger's process.
// @scenario "Up deregisters a dead stack's hostnames before it provisions"
func TestUpDeregistersADeadStacksRoutesBeforeProvisioning(t *testing.T) {
	store := &fakeStore{
		stacks:    []domain.Stack{droppedStack(42)},
		slugCache: map[string]string{"/wt/feat-x": "feat-x"},
	}
	sys := &fakeSystem{alive: map[int]bool{42: false}}
	o, proxy := deadStackOrch(store, sys, time.Hour)

	proceed, err := o.reconcileRunningStack(UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}, PlanOptions{})
	if err != nil {
		t.Fatalf("a dead launcher must not block up: %v", err)
	}
	if !proceed {
		t.Fatal("a dead launcher must not block provisioning")
	}
	for _, route := range []string{"app.feat-x", "gateway.feat-x", "nlp.feat-x", "langyagent.feat-x", "clickhouse.feat-x"} {
		if !slices.Contains(proxy.removed, route) {
			t.Errorf("route %q outlived the stack it pointed at (removed: %v)", route, proxy.removed)
		}
	}
}
