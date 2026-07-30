package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
)

// A play sandbox installs a PR's dependencies. This repo has a postinstall and
// a PR controls package scripts, so a plain install runs PR-authored code with
// the developer's environment before any gate on the application code matters.
//
// @scenario "The sandbox never runs the checkout's package scripts"
func TestEnsureDepsSuppressesLifecycleScriptsForUntrustedCheckouts(t *testing.T) {
	// A lockfile with no install stamp is the "must install" state.
	staleDir := func(t *testing.T) string {
		t.Helper()
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "pnpm-lock.yaml"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		return dir
	}

	t.Run("given an untrusted checkout", func(t *testing.T) {
		t.Run("when dependencies install, lifecycle scripts are suppressed", func(t *testing.T) {
			sup := &fakeSupervisor{}
			o := &Orchestrator{sup: sup, log: zap.NewNop()}
			if err := o.ensureDeps(context.Background(), staleDir(t), false); err != nil {
				t.Fatalf("ensureDeps: %v", err)
			}
			if len(sup.shells) != 1 {
				t.Fatalf("shells = %v, want one install", sup.shells)
			}
			if !strings.Contains(sup.shells[0], "--ignore-scripts") {
				t.Errorf("install = %q, want --ignore-scripts", sup.shells[0])
			}
		})
	})

	t.Run("given the developer's own worktree", func(t *testing.T) {
		t.Run("when dependencies install, the repo's postinstall still runs", func(t *testing.T) {
			sup := &fakeSupervisor{}
			o := &Orchestrator{sup: sup, log: zap.NewNop()}
			if err := o.ensureDeps(context.Background(), staleDir(t), true); err != nil {
				t.Fatalf("ensureDeps: %v", err)
			}
			if len(sup.shells) != 1 {
				t.Fatalf("shells = %v, want one install", sup.shells)
			}
			if strings.Contains(sup.shells[0], "--ignore-scripts") {
				t.Errorf("install = %q, want a normal install in your own worktree", sup.shells[0])
			}
		})
	})
}

// @scenario "Stale dependencies install themselves"
func TestDepsStale(t *testing.T) {
	write := func(t *testing.T, dir, rel string, mtime time.Time) {
		t.Helper()
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, mtime, mtime); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()

	t.Run("given no lockfile, nothing is stale", func(t *testing.T) {
		if depsStale(t.TempDir()) {
			t.Error("a directory with no lockfile has nothing to install")
		}
	})

	t.Run("given a lockfile and no install stamp, deps are stale", func(t *testing.T) {
		dir := t.TempDir()
		write(t, dir, "pnpm-lock.yaml", now)
		if !depsStale(dir) {
			t.Error("never-installed modules are stale")
		}
	})

	t.Run("given the stamp is newer than the lockfile, deps are fresh", func(t *testing.T) {
		dir := t.TempDir()
		write(t, dir, "pnpm-lock.yaml", now.Add(-time.Hour))
		write(t, dir, "node_modules/.modules.yaml", now)
		if depsStale(dir) {
			t.Error("an install after the last lockfile change is fresh")
		}
	})

	t.Run("given the lockfile changed after the last install, deps are stale", func(t *testing.T) {
		dir := t.TempDir()
		write(t, dir, "node_modules/.modules.yaml", now.Add(-time.Hour))
		write(t, dir, "pnpm-lock.yaml", now)
		if !depsStale(dir) {
			t.Error("a lockfile newer than the install stamp is stale")
		}
	})
}

// The repo is a single pnpm workspace (ADR-076): the lockfile and node_modules
// live at the root, and langwatch/ has neither. ensureDeps used to trust its
// caller to pass the root; both call sites passed langwatch/, depsStale found
// no lockfile there and read that as "nothing to install" — so `haven up` in a
// fresh worktree silently installed nothing and started every service against
// absent dependencies. ensureDeps resolves the workspace root itself now, so
// the test exercises the regression directly: hand it the WRONG directory (the
// member, exactly what the broken call sites passed) and the install must
// still land at the root.
//
// @scenario A fresh clone needs one install
func TestEnsureDepsInstallsAtTheWorkspaceRoot(t *testing.T) {
	// A checkout shaped like the repo: lockfile at the root, none in langwatch/.
	repo := func(t *testing.T) (root, lwDir string) {
		t.Helper()
		root = t.TempDir()
		lwDir = filepath.Join(root, "langwatch")
		if err := os.MkdirAll(lwDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		return root, lwDir
	}

	t.Run("given a workspace whose lockfile is only at the root", func(t *testing.T) {
		t.Run("when handed the member directory, the install still runs at the root", func(t *testing.T) {
			root, lwDir := repo(t)
			sup := &fakeSupervisor{}
			o := &Orchestrator{sup: sup, log: zap.NewNop()}
			if err := o.ensureDeps(context.Background(), lwDir, true); err != nil {
				t.Fatalf("ensureDeps: %v", err)
			}
			if len(sup.dirs) != 1 {
				t.Fatalf("dirs = %v, want exactly one install", sup.dirs)
			}
			if sup.dirs[0] != root {
				t.Fatalf("install ran in %q, want the workspace root %q", sup.dirs[0], root)
			}
		})

		t.Run("when handed the root itself, the install runs there", func(t *testing.T) {
			root, _ := repo(t)
			sup := &fakeSupervisor{}
			o := &Orchestrator{sup: sup, log: zap.NewNop()}
			if err := o.ensureDeps(context.Background(), root, true); err != nil {
				t.Fatalf("ensureDeps: %v", err)
			}
			if len(sup.dirs) != 1 || sup.dirs[0] != root {
				t.Fatalf("dirs = %v, want one install at %q", sup.dirs, root)
			}
		})

		t.Run("when no lockfile exists anywhere above, nothing installs", func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "langwatch")
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			sup := &fakeSupervisor{}
			o := &Orchestrator{sup: sup, log: zap.NewNop()}
			if err := o.ensureDeps(context.Background(), dir, true); err != nil {
				t.Fatalf("ensureDeps: %v", err)
			}
			if len(sup.dirs) != 0 {
				t.Fatalf("dirs = %v, want no install", sup.dirs)
			}
		})
	})
}
