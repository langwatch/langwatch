package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"syscall"
	"time"
)

// A foreground `haven up` has exactly one owner: whatever launched it. A
// human's up detaches (startDetachedUp) and hands the stack to `haven down`,
// but the foreground run an agent or a pipe gets has no such handover, and a
// launcher killed by pid sends no signal. Observed: a foreground
// `haven up --agent` still supervising a full stack two days after the agent
// session that ran it was gone. So the foreground run watches the process
// group it was launched into — the same semantics dev-supervisor.mjs uses —
// and shuts down as if interrupted when that group loses its leader.
//
// An interactive job is its own process-group leader, and the detached child
// runs under Setsid, so both shapes resolve to "nothing to watch" and keep
// their lifetime exactly as it was.

// launcherWatchInterval is how often the leader is looked at. Death is only
// ever noticed late by at most one interval, and the check is one kill(2).
const launcherWatchInterval = 5 * time.Second

// groupLeaderToWatch decides whether this process's group has a leader worth
// watching: not the kernel's groups (pgid <= 1), not ourselves (the
// interactive-job shape, where the tty owns the lifetime), and not a leader
// that is already gone, which leaves nothing to observe.
func groupLeaderToWatch(pid, pgid int, alive func(int) bool) int {
	if pgid <= 1 || pgid == pid {
		return 0
	}
	if !alive(pgid) {
		return 0
	}
	return pgid
}

// processAlive reports whether pid exists. EPERM means it does, owned by
// someone else.
func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// processWatch is one pid to poll and what to do when it disappears.
type processWatch struct {
	pid    int
	every  time.Duration
	alive  func(int) bool
	onGone func()
}

// watchProcessGone runs w.onGone when w.pid disappears, checking every
// w.every. It stops quietly when ctx ends first.
func watchProcessGone(ctx context.Context, w processWatch) {
	t := time.NewTicker(w.every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if !w.alive(w.pid) {
				w.onGone()
				return
			}
		}
	}
}

// watchLaunchingGroup returns a context that is canceled when the process
// group this run was launched into loses its leader. When there is nothing to
// watch, the context comes back unchanged and the cancel is a no-op.
func watchLaunchingGroup(ctx context.Context) (context.Context, context.CancelFunc) {
	leader := groupLeaderToWatch(os.Getpid(), syscall.Getpgrp(), processAlive)
	if leader == 0 {
		return ctx, func() {}
	}
	ctx, cancel := context.WithCancel(ctx)
	go watchProcessGone(ctx, processWatch{
		pid:   leader,
		every: launcherWatchInterval,
		alive: processAlive,
		onGone: func() {
			fmt.Fprintf(os.Stderr, "haven: the process group that launched this up (%d) is gone — shutting the stack down\n", leader)
			cancel()
		},
	})
	return ctx, cancel
}
