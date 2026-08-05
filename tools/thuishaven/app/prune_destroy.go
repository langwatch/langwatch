package app

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

// destroyConcurrency bounds how many worktrees the bulk delete tears down at
// once. Each teardown is a bounded wait for a launcher to exit, a couple of
// DROP DATABASE calls, and an rm of a whole tree — IO-bound work that overlaps
// well, but not so many at once that the disk or the database servers thrash.
const destroyConcurrency = 4

// DestroyWorktrees removes several worktrees at once, concurrently: for each it
// stops any stack, waits for it to die, drops its databases, and removes its
// directory tree — then prunes git's worktree admin entries once, at the end.
// This is the interactive prune's bulk delete, and running the per-worktree work
// in parallel is what keeps it responsive on a fleet: the slow parts (the bounded
// wait for a launcher to exit, dropping databases, rm-ing a node_modules tree)
// overlap instead of summing. onDone is called once per input dir with its result
// the moment that dir finishes, so the caller can stream live progress; it may run
// from any worker goroutine, so it must be safe to call concurrently.
//
// Unlike the single-worktree DestroyWorktree it removes each directory tree
// directly (o.hyg.Remove) rather than via `git worktree remove`, and prunes the
// admin entries in one final pass — so no two goroutines ever mutate git's shared
// worktree metadata at once. The same guards apply per dir: the primary checkout
// and the launch worktree are refused, and an unknown dir is rejected.
func (o *Orchestrator) DestroyWorktrees(ctx context.Context, gitDir string, dirs []string, selfDir string, onDone func(dir string, err error)) {
	report := func(dir string, err error) {
		if onDone != nil {
			onDone(dir, err)
		}
	}
	if o.hyg == nil {
		for _, dir := range dirs {
			report(dir, fmt.Errorf("hygiene adapter not wired"))
		}
		return
	}
	worktrees, err := o.hyg.Worktrees(gitDir)
	if err != nil {
		for _, dir := range dirs {
			report(dir, fmt.Errorf("listing worktrees: %w", err))
		}
		return
	}
	primaryCanon := ""
	if len(worktrees) > 0 {
		primaryCanon = canonicalPath(worktrees[0].Dir)
	}
	selfCanon := canonicalPath(selfDir)

	var wg sync.WaitGroup
	var removedAny atomic.Bool
	slots := make(chan struct{}, destroyConcurrency)
	for _, dir := range dirs {
		wg.Add(1)
		go func(dir string) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			derr := o.destroyWorktreeDir(ctx, dir, primaryCanon, selfCanon, worktrees)
			if derr == nil {
				removedAny.Store(true)
			}
			report(dir, derr)
		}(dir)
	}
	wg.Wait()

	// One prune after every removal: git's worktree admin is shared state, so it is
	// mutated exactly once here rather than raced across the workers.
	if removedAny.Load() {
		o.hyg.PruneGitWorktrees(gitDir)
	}
}

// destroyWorktreeDir is one worktree's share of DestroyWorktrees: guard, stop +
// drop, then remove the directory tree — leaving the git admin entry for the
// caller's single final prune. It returns an error naming why nothing was removed.
func (o *Orchestrator) destroyWorktreeDir(ctx context.Context, dir, primaryCanon, selfCanon string, worktrees []Worktree) error {
	canon := canonicalPath(dir)
	if primaryCanon != "" && canon == primaryCanon {
		return fmt.Errorf("refusing to destroy %s — it is the repository's primary checkout", dir)
	}
	if canon == selfCanon {
		return fmt.Errorf("refusing to destroy %s — haven is running from it", dir)
	}
	if !isKnownWorktree(worktrees, canon) {
		return fmt.Errorf("%s is not a worktree of this repository", dir)
	}
	o.stopAndDropForDir(ctx, canon)
	if err := o.hyg.Remove(canon); err != nil {
		return fmt.Errorf("removing worktree directory: %w", err)
	}
	return nil
}
