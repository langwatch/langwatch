package app

import (
	"strings"
	"testing"
	"time"

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

// @scenario "A service the stack does not run is started from its row"
func TestStartStackService(t *testing.T) {
	t.Run("given a registered stack, adding a selectable service runs up +<service> in its worktree", func(t *testing.T) {
		o, sys := startOrch(t)
		if err := o.StartStackService("main", "llm"); err != nil {
			t.Fatalf("StartStackService: %v", err)
		}
		if len(sys.spawned) != 1 || sys.spawned[0].Dir != "/repo" || strings.Join(sys.spawned[0].Argv, " ") != "/usr/local/bin/haven up +llm" {
			t.Errorf("spawned %v", sys.spawned)
		}
	})

	t.Run("given an unknown service or an unregistered slug, nothing runs", func(t *testing.T) {
		o, sys := startOrch(t)
		for _, c := range [][2]string{{"main", "llm --force"}, {"main", "api"}, {"nope", "llm"}} {
			if err := o.StartStackService(c[0], c[1]); err == nil {
				t.Errorf("StartStackService(%q, %q) should be refused", c[0], c[1])
			}
		}
		if len(sys.spawned) != 0 {
			t.Errorf("a refused start must spawn nothing, got %v", sys.spawned)
		}
	})
}

// @scenario "A stack whose database is below the upgrade floor can reset its databases from the stack home"
func TestResetStackDatabases(t *testing.T) {
	t.Run("given a registered stack, the reset runs db reset --yes in its worktree with the slug pinned", func(t *testing.T) {
		o, sys := startOrch(t)
		if err := o.ResetStackDatabases("main"); err != nil {
			t.Fatalf("ResetStackDatabases: %v", err)
		}
		want := "/usr/bin/env LANGWATCH_SLUG=main /usr/local/bin/haven db reset --yes"
		if len(sys.spawned) != 1 || sys.spawned[0].Dir != "/repo" || strings.Join(sys.spawned[0].Argv, " ") != want {
			t.Errorf("spawned %v, want %q in /repo", sys.spawned, want)
		}
		if got := o.cfg.UpArgv; len(got) != 2 || got[1] != "up" {
			t.Errorf("the configured up argv was changed: %v", got)
		}
	})

	t.Run("given a slug with no registered stack, nothing is reset", func(t *testing.T) {
		o, sys := startOrch(t)
		if err := o.ResetStackDatabases("idle"); err == nil {
			t.Error("an unregistered slug should be refused")
		}
		if len(sys.spawned) != 0 {
			t.Errorf("spawned %v", sys.spawned)
		}
	})
}

// @scenario "The stack home seeds a stack at a chosen size and shows its progress"
func TestSeedStack(t *testing.T) {
	t.Run("given a registered stack, the seed runs haven db seed in its worktree with the slug pinned", func(t *testing.T) {
		o, sys := startOrch(t)
		sys.now = time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC)
		o.cfg.Home = t.TempDir()
		if err := o.SeedStack("main", "small", "startup"); err != nil {
			t.Fatalf("SeedStack: %v", err)
		}
		want := "/usr/bin/env LANGWATCH_SLUG=main /usr/local/bin/haven db seed --size small --persona startup"
		if len(sys.spawned) != 1 || sys.spawned[0].Dir != "/repo" || strings.Join(sys.spawned[0].Argv, " ") != want {
			t.Errorf("spawned %v, want %q in /repo", sys.spawned, want)
		}
	})

	t.Run("given a size seedgen does not know, nothing is spawned", func(t *testing.T) {
		o, sys := startOrch(t)
		sys.now = time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC)
		if err := o.SeedStack("main", "huge", "all"); err == nil {
			t.Error("an unknown size should be refused")
		}
		if len(sys.spawned) != 0 {
			t.Errorf("spawned %v", sys.spawned)
		}
	})

	t.Run("given a slug with no registered stack, nothing is seeded", func(t *testing.T) {
		o, sys := startOrch(t)
		sys.now = time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC)
		o.cfg.Home = t.TempDir()
		if err := o.SeedStack("idle", "tiny", "all"); err == nil {
			t.Error("an unregistered slug should be refused")
		}
		if len(sys.spawned) != 0 {
			t.Errorf("spawned %v", sys.spawned)
		}
	})
}
