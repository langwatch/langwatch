package app

import (
	"context"
	"slices"
	"strings"
	"testing"

	"go.uber.org/zap"
)

type fakeSemaphore struct {
	acquired  int
	released  int
	lastSlots int
	lastName  string
	// free is how many more slots TryAcquire hands out before reporting none.
	free int
}

func (f *fakeSemaphore) TryAcquire(name string, slots int) (func(), int, bool, error) {
	if f.free == 0 {
		return nil, 0, false, nil
	}
	f.free--
	f.acquired++
	return func() { f.released++ }, 2, true, nil
}

func (f *fakeSemaphore) Acquire(_ context.Context, name string, slots int) (func(), int, error) {
	f.acquired++
	f.lastSlots = slots
	f.lastName = name
	return func() { f.released++ }, 1, nil
}

// @scenario "haven machine typecheck is not gated twice"
func TestTypecheckDisablesTheScriptsOwnQueue(t *testing.T) {
	sup := &fakeSupervisor{}
	sem := &fakeSemaphore{}
	orch := &Orchestrator{
		cfg: Config{IsAgent: true},
		sup: sup,
		sys: &fakeSystem{},
		sem: sem,
		log: zap.NewNop(),
	}

	if err := orch.Typecheck(context.Background(), TypecheckRun{RepoDir: "/repo", SlotsOverride: 3}); err != nil {
		t.Fatalf("Typecheck: %v", err)
	}

	if sem.acquired != 1 || sem.released != 1 {
		t.Fatalf("expected exactly one slot taken and released, got %d/%d", sem.acquired, sem.released)
	}
	if sem.lastSlots != 3 {
		t.Fatalf("expected the override to pick the slot count, got %d", sem.lastSlots)
	}
	if len(sup.envs) != 1 || !slices.Contains(sup.envs[0], "CHECK_SLOTS=0") {
		t.Fatalf("expected the spawned run to have its own queue disabled, got env %v", sup.envs)
	}
}

// @scenario "haven machine typecheck and delegated checks share one counter"
func TestTypecheckCountsAgainstTheSharedChecksSemaphore(t *testing.T) {
	sem := &fakeSemaphore{}
	orch := &Orchestrator{
		cfg: Config{IsAgent: true},
		sup: &fakeSupervisor{},
		sys: &fakeSystem{},
		sem: sem,
		log: zap.NewNop(),
	}

	if err := orch.Typecheck(context.Background(), TypecheckRun{RepoDir: "/repo", SlotsOverride: 1}); err != nil {
		t.Fatalf("Typecheck: %v", err)
	}

	if sem.lastName != "checks" {
		t.Fatalf("typecheck must gate on the shared %q semaphore, got %q", "checks", sem.lastName)
	}
}

func TestTypecheckDefaultUsesTheSharedCapacityPolicy(t *testing.T) {
	sem := &fakeSemaphore{}
	orch := runOrch(&fakeStore{}, &fakeSupervisor{})
	orch.sem = sem
	orch.cfg.CheckEnv.CheckSlots = "2"
	if err := orch.Typecheck(context.Background(), TypecheckRun{RepoDir: "/repo"}); err != nil {
		t.Fatal(err)
	}
	if sem.lastSlots != 2 {
		t.Fatalf("typecheck ignored the shared queue capacity: %d", sem.lastSlots)
	}
}

// --affected is the same root `pnpm typecheck`: one slot, no Nx fan-out.
// @scenario "An agent's typecheck is the affected one"
func TestTypecheckAffectedRunsTheRootTypecheckOnOneSlot(t *testing.T) {
	sup := &fakeSupervisor{}
	sem := &fakeSemaphore{free: 2}
	orch := &Orchestrator{cfg: Config{IsAgent: true}, sup: sup, sys: &fakeSystem{}, sem: sem, log: zap.NewNop()}

	if err := orch.Typecheck(context.Background(), TypecheckRun{RepoDir: "/repo", ExtraArgs: []string{"--verbose"}, SlotsOverride: 4, Affected: true}); err != nil {
		t.Fatalf("Typecheck: %v", err)
	}
	if sem.acquired != 1 || sem.released != 1 {
		t.Fatalf("want one slot taken and released, got %d/%d", sem.acquired, sem.released)
	}
	if shell := sup.shells[0]; shell != "pnpm typecheck '--verbose'" {
		t.Fatalf("unexpected shell %q", shell)
	}
	for _, e := range sup.envs[0] {
		if strings.HasPrefix(e, "NX_PARALLEL=") {
			t.Fatalf("want no NX_PARALLEL, got env %v", sup.envs[0])
		}
	}
}
