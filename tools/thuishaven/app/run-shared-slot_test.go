package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type heldRunSupervisor struct {
	Supervisor
	started chan struct{}
	finish  chan struct{}
}

func (s *heldRunSupervisor) RunOnce(ctx context.Context, _, _, _ string, _ []string) error {
	close(s.started)
	select {
	case <-s.finish:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func sharedRunOrch(t *testing.T) (*Orchestrator, *semaphore.Semaphore) {
	t.Helper()
	sem := semaphore.New(t.TempDir())
	o := runOrch(&fakeStore{}, &fakeSupervisor{})
	o.sem = sem
	o.cfg.CheckEnv = domain.CheckEnv{CheckSlots: "1"}
	return o, sem
}

// @scenario "Manual checks and agent hooks share admission"
func TestManualSlotBlocksHookRun(t *testing.T) {
	o, sem := sharedRunOrch(t)
	release, _, err := sem.Acquire(context.Background(), "checks", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	err = o.RunHeavy(ctx, HeavyRun{Shell: "pnpm typecheck worker"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("manual slot must block hook run: %v", err)
	}
	if len(o.sup.(*fakeSupervisor).shells) != 0 {
		t.Fatal("blocked compiler started")
	}
}

// @scenario "Manual checks and agent hooks share admission"
func TestHookRunBlocksManualSlotAndReleases(t *testing.T) {
	o, sem := sharedRunOrch(t)
	sup := &heldRunSupervisor{started: make(chan struct{}), finish: make(chan struct{})}
	o.sup = sup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- o.RunHeavy(ctx, HeavyRun{Shell: "pnpm typecheck worker"}) }()
	select {
	case <-sup.started:
	case <-time.After(5 * time.Second):
		t.Fatal("hook run did not start")
	}
	release, _, acquired, err := sem.TryAcquire("checks", 1)
	if acquired {
		release()
	}
	if err != nil || acquired {
		t.Fatalf("manual check bypassed active hook run: acquired=%v err=%v", acquired, err)
	}
	close(sup.finish)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	release, _, acquired, err = sem.TryAcquire("checks", 1)
	if acquired {
		defer release()
	}
	if err != nil || !acquired {
		t.Fatalf("completed hook retained the slot: acquired=%v err=%v", acquired, err)
	}
}

func TestHookSlotWaitCeilingDoesNotReleaseAnotherRun(t *testing.T) {
	o, sem := sharedRunOrch(t)
	release, _, err := sem.Acquire(context.Background(), "checks", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	_, queued, fallbackRelease, err := o.acquireCheckSlot(context.Background(), 20*time.Millisecond)
	if err != nil || !queued {
		t.Fatalf("wait ceiling did not allow fallback: queued=%v err=%v", queued, err)
	}
	fallbackRelease()
	otherRelease, _, acquired, err := sem.TryAcquire("checks", 1)
	if acquired {
		otherRelease()
	}
	if err != nil || acquired {
		t.Fatalf("fallback released another owner's slot: %v %v", acquired, err)
	}
}

// @scenario "Manual checks and agent hooks share admission"
func TestManualSlotReleaseHandsOffToHook(t *testing.T) {
	o, sem := sharedRunOrch(t)
	release, _, err := sem.Acquire(context.Background(), "checks", 1)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			release()
		}
	}()
	sup := &heldRunSupervisor{started: make(chan struct{}), finish: make(chan struct{})}
	o.sup = sup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- o.RunHeavy(ctx, HeavyRun{Shell: "pnpm typecheck worker"}) }()
	select {
	case <-sup.started:
		t.Fatal("hook bypassed the held manual slot")
	case <-time.After(150 * time.Millisecond):
	}
	releasedAt := time.Now()
	release()
	held = false
	select {
	case <-sup.started:
		t.Logf("manual release to hook start: %s", time.Since(releasedAt))
	case <-time.After(3 * time.Second):
		t.Fatal("released slot was not handed off")
	}
	close(sup.finish)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

type unavailableSemaphore struct{}

func (unavailableSemaphore) Acquire(context.Context, string, int) (func(), int, error) {
	return nil, 0, errors.New("lock directory unavailable")
}

func TestHookRunProceedsWhenSemaphoreStorageFails(t *testing.T) {
	o, _ := sharedRunOrch(t)
	o.sem = unavailableSemaphore{}
	if err := o.RunHeavy(context.Background(), HeavyRun{Shell: "pnpm typecheck worker"}); err != nil {
		t.Fatal(err)
	}
	if got := o.sup.(*fakeSupervisor).shells; len(got) != 1 || got[0] != "pnpm typecheck worker" {
		t.Fatalf("failed queue storage blocked the command: %v", got)
	}
}
