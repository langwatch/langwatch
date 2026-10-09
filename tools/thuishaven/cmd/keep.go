package cmd

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// runKeep is the hidden `haven keep <slug>`, the stack's keeper (section 11.1
// of dev/docs/plans/haven-one-go-process-2026-10-09.md). The up's base
// environment replaces this process's own before any lane starts; it is never
// printed.
func runKeep(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) != 1 {
		return errors.New("usage: haven keep <slug>")
	}
	plan, err := d.orch.ReadKeeperPlan(inv.args[0])
	if err != nil {
		return err
	}
	os.Clearenv()
	for _, kv := range plan.Env {
		if k, v, ok := strings.Cut(kv, "="); ok {
			_ = os.Setenv(k, v)
		}
	}
	return d.orch.Keep(ctx, inv.args[0], plan)
}

// isSessionLeader is true for an up started under Setsid (`-d`, the terminal
// viewer's child, the hub): it hands over and exits, owning nothing.
func isSessionLeader() bool {
	sid, err := unix.Getsid(0)
	return err == nil && sid == os.Getpid()
}

// followAsOwner is the foreground up after its hand-over (D7): it prints the
// keeper's log until it is stopped or its launching group goes, then downs
// the stack. A stack it does not own, or one downed elsewhere, ends it quietly.
func followAsOwner(ctx context.Context, d deps) error {
	slug, err := d.orch.ResolveSlug(d.params)
	if err != nil {
		return err
	}
	self := os.Getpid()
	if !d.orch.IsStackOwner(slug, self) {
		return nil
	}
	f, err := os.Open(stackLogPath(d.worktree, slug))
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	_, _ = f.Seek(0, io.SeekEnd)
	t := time.NewTicker(300 * time.Millisecond)
	defer t.Stop()
	for {
		_, _ = io.Copy(os.Stdout, f)
		select {
		case <-ctx.Done():
			return d.orch.Down(context.WithoutCancel(ctx), d.params, false)
		case <-t.C:
			if !d.orch.IsStackOwner(slug, self) {
				return nil
			}
		}
	}
}
