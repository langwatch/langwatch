package app

import (
	"context"
	"slices"
	"testing"

	"go.uber.org/zap"
)

type fakeSemaphore struct {
	acquired  int
	released  int
	lastSlots int
	lastName  string
}

func (f *fakeSemaphore) Acquire(_ context.Context, name string, slots int) (func(), int, error) {
	f.acquired++
	f.lastSlots = slots
	f.lastName = name
	return func() { f.released++ }, 1, nil
}

// @scenario "haven typecheck is not gated twice"
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

	if err := orch.Typecheck(context.Background(), "/repo/platform/app", nil, 3, 0); err != nil {
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

// @scenario "haven typecheck and delegated checks share one counter"
func TestTypecheckCountsAgainstTheSharedChecksSemaphore(t *testing.T) {
	sem := &fakeSemaphore{}
	orch := &Orchestrator{
		cfg: Config{IsAgent: true},
		sup: &fakeSupervisor{},
		sys: &fakeSystem{},
		sem: sem,
		log: zap.NewNop(),
	}

	if err := orch.Typecheck(context.Background(), "/repo/platform/app", nil, 1, 0); err != nil {
		t.Fatalf("Typecheck: %v", err)
	}

	if sem.lastName != "checks" {
		t.Fatalf("typecheck must gate on the shared %q semaphore, got %q", "checks", sem.lastName)
	}
}
