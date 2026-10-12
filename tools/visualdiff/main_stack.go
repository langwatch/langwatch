package visualdiff

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// MainStackRequest is diffsuite's ask for pinned main as a haven stack of its own.
type MainStackRequest struct {
	Root, RunDir, Slug string
	Stderr             io.Writer
}

// BootMainStack brings origin/main up at the pin a run would render (pin.go) as the
// haven stack Slug, from the base's persistent worktree unless a live run holds it,
// the way a run boots its base. The stop it answers destroys the stack and gives the
// worktree back, and is due whatever the error.
func BootMainStack(ctx context.Context, request MainStackRequest) (string, func(), error) {
	run := &session{
		request: Request{Options: Options{
			Root: request.Root, RunDir: request.RunDir, BaseRef: "origin/main",
			BootTimeout: 20 * time.Minute, Stall: 90 * time.Second,
		}},
		streams: Streams{Out: request.Stderr, Err: request.Stderr},
		phases:  &phaseClock{stderr: request.Stderr},
		runID:   havenrun.RunID(request.RunDir),
	}
	run.request.Deps.fill()
	unmark, err := MarkRun(request.RunDir, false)
	stop := func() {
		if err := run.teardownHaven(context.WithoutCancel(ctx)); err != nil {
			fmt.Fprintln(request.Stderr, err)
		}
		unmark()
	}
	if err != nil {
		return "", stop, err
	}
	dir, persistent, err := claimWorktree(request.Root, request.RunDir, "base")
	if err != nil {
		return "", stop, err
	}
	commit := pinMain(ctx, run.request, request.Stderr)
	run.plan.Base = Stack{Name: "main", Ref: commit, Dir: dir, Persistent: persistent, HavenSlug: request.Slug}
	if err := run.checkoutForHaven(ctx, &run.plan.Base); err != nil {
		return "", stop, err
	}
	if err := run.havenUp(ctx, run.plan.Base); err != nil {
		return "", stop, err
	}
	err = run.awaitStack(ctx, &run.plan.Base)
	return run.plan.Base.URL(), stop, err
}
