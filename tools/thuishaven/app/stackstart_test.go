package app

import (
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// startOrch wires an orchestrator whose repository has two worktrees, one of
// which already has a live stack.
func startOrch(t *testing.T) (*Orchestrator, *fakeSystem) {
	t.Helper()
	sys := &fakeSystem{alive: map[int]bool{99: true}}
	return &Orchestrator{
		cfg: Config{RepoRoot: "/repo", Home: "/home/haven", UpArgv: []string{"/usr/local/bin/haven", "up"}},
		hyg: &fakeHygiene{worktrees: []Worktree{
			{Dir: "/repo", Branch: "main"},
			{Dir: "/repo/.claude/worktrees/idle", Branch: "feat/idle"},
		}},
		store: &fakeStore{stacks: []domain.Stack{{Slug: "main", WorktreeDir: "/repo", LauncherPID: 99}}},
		sys:   sys,
		log:   zap.NewNop(),
	}, sys
}

// @scenario "A worktree with nothing running can be started from the dashboard"
func TestStartWorktreeStack(t *testing.T) {
	t.Run("given a worktree git lists with no stack running in it", func(t *testing.T) {
		o, sys := startOrch(t)

		t.Run("when it is started", func(t *testing.T) {
			if err := o.StartWorktreeStack("/repo/.claude/worktrees/idle"); err != nil {
				t.Fatalf("StartWorktreeStack: %v", err)
			}
			if len(sys.spawned) != 1 {
				t.Fatalf("spawned %d processes, want 1", len(sys.spawned))
			}
			if got := sys.spawned[0].Dir; got != "/repo/.claude/worktrees/idle" {
				t.Errorf("ran in %q", got)
			}
			// The argv is resolved once, in the composition root, against the
			// trusted checkout — never derived from the directory the child runs in.
			if got := sys.spawned[0].Argv; len(got) != 2 || got[0] != "/usr/local/bin/haven" || got[1] != "up" {
				t.Errorf("argv = %v", got)
			}
		})
	})

	t.Run("given a directory git does not list as a worktree", func(t *testing.T) {
		o, sys := startOrch(t)

		// This is reachable from a browser POST. A path taken on trust is a path
		// that starts a process wherever the request says.
		for _, dir := range []string{"/tmp/evil", "/repo/.claude/worktrees/idle/../../../tmp", "", "/repo/.claude"} {
			if err := o.StartWorktreeStack(dir); err == nil {
				t.Errorf("starting %q should be refused", dir)
			}
		}
		if len(sys.spawned) != 0 {
			t.Fatalf("a refused directory must spawn nothing, got %v", sys.spawned)
		}
	})

	t.Run("given a worktree whose stack is already live", func(t *testing.T) {
		o, sys := startOrch(t)
		err := o.StartWorktreeStack("/repo")
		if err == nil || !strings.Contains(err.Error(), "already running") {
			t.Errorf("err = %v, want an already-running refusal", err)
		}
		if len(sys.spawned) != 0 {
			t.Error("a second launcher for one worktree is two stacks fighting over one registry entry")
		}
	})

	t.Run("given a haven with no up argv resolved", func(t *testing.T) {
		o, sys := startOrch(t)
		o.cfg.UpArgv = nil
		if err := o.StartWorktreeStack("/repo/.claude/worktrees/idle"); err == nil {
			t.Error("without an argv there is nothing to run")
		}
		if len(sys.spawned) != 0 {
			t.Error("and nothing may be run")
		}
	})
}
