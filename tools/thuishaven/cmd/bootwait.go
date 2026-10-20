package cmd

import (
	"context"
	"os"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/fileregistry"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// bootWaitPoll is how often a boot claim checks whether its stack answers.
const bootWaitPoll = time.Second

// claimBootWait registers this process as blocked on slug's boot until the
// stack answers or ctx ends (domain.ResolveCapacity): meanwhile a check gets
// half the budget and the background band. The release is safe to call twice.
func claimBootWait(ctx context.Context, d deps, slug string) func() {
	if slug == "" {
		return func() {}
	}
	drop, err := fileregistry.New(havenHome()).ClaimWaiter(os.Getpid(), domain.BootWaitName, fileregistry.WaiterClaim{
		Command: slug, Class: "boot", Worktree: d.worktree, QueuedAt: time.Now(),
	})
	if err != nil {
		return func() {}
	}
	done := make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(done); drop() }) }
	go releaseWhenReady(ctx, bootWatch{d: d, slug: slug, done: done, release: release})
	return release
}

// bootWatch is one boot claim being watched until its stack answers.
type bootWatch struct {
	d       deps
	slug    string
	done    chan struct{}
	release func()
}

// releaseWhenReady drops the claim once the stack answers or ctx ends.
func releaseWhenReady(ctx context.Context, w bootWatch) {
	ticker := time.NewTicker(bootWaitPoll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			w.release()
			return
		case <-w.done:
			return
		case <-ticker.C:
			if reached(w.d.orch.SessionSnapshot(w.slug), "ready") {
				w.release()
				return
			}
		}
	}
}
