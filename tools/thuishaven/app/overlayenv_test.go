package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestRetireOverlayFiles(t *testing.T) {
	t.Run("given a worktree holding an overlay an older haven wrote", func(t *testing.T) {
		t.Run("when the stack comes up", func(t *testing.T) {
			dir := t.TempDir()
			for _, name := range RetiredOverlayFiles {
				if err := os.WriteFile(filepath.Join(dir, name), []byte("DATABASE_URL=x\n"), 0o600); err != nil {
					t.Fatalf("write %s: %v", name, err)
				}
			}

			(&Orchestrator{}).retireOverlayFiles(dir)

			for _, name := range RetiredOverlayFiles {
				if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
					t.Errorf("%s survived the up — a stale copy of a stack that has since come down", name)
				}
			}
		})
	})

	t.Run("given a worktree with no overlay file", func(t *testing.T) {
		t.Run("when the stack comes up", func(t *testing.T) {
			dir := t.TempDir()
			(&Orchestrator{}).retireOverlayFiles(dir)
			entries, err := os.ReadDir(dir)
			if err != nil {
				t.Fatalf("read dir: %v", err)
			}
			if len(entries) != 0 {
				t.Errorf("the migration must create nothing, found %v", entries)
			}
		})
	})
}

// What the file used to hold is exactly what a child is handed and what
// `haven env` prints: one source, three consumers, no copy on disk.
func TestStackEnvIsWhatTheOverlayFileHeld(t *testing.T) {
	st := domain.Stack{
		Slug: "plum", WorktreeDir: "/wt/plum", APIPort: 41001, WorkerMetricsPort: 41002,
		RedisDB: 3, PostgresPort: 5432, PostgresDatabase: "lw_plum",
		Services: []domain.Service{{Name: "app", Port: 41000, URL: "https://app.plum.langwatch.localhost"}},
	}
	o := &Orchestrator{store: &fakeStore{stacks: []domain.Stack{st}}}

	env, err := o.StackEnv(UpParams{WorktreeDir: "/wt/plum"})
	if err != nil {
		t.Fatalf("StackEnv: %v", err)
	}
	values := domain.EnvMap(env)
	for key, want := range map[string]string{
		"LANGWATCH_PORTLESS": "1",
		"LANGWATCH_SLUG":     "plum",
		"BASE_HOST":          "https://app.plum.langwatch.localhost",
		"DATABASE_URL":       "postgresql://prisma:prisma@127.0.0.1:5432/lw_plum",
	} {
		if got := values[key]; got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}

	// Every lane haven supervises starts with the same set, so a shell that
	// evaluates `haven env` and a lane are looking at one environment.
	children := (&Orchestrator{proxy: stubProxy{}}).planChildren(st, PlanOptions{Selection: domain.DefaultSelection()}, "/wt/plum", "")
	if len(children) == 0 {
		t.Fatal("no children planned")
	}
	for _, child := range children {
		childValues := domain.EnvMap(child.Env)
		for _, key := range []string{"LANGWATCH_SLUG", "BASE_HOST", "DATABASE_URL"} {
			if childValues[key] != values[key] {
				t.Errorf("lane %s: %s = %q, want the overlay's %q", child.Name, key, childValues[key], values[key])
			}
		}
	}
}

func TestStackEnvWithoutAStack(t *testing.T) {
	t.Run("given this worktree has never run haven up", func(t *testing.T) {
		t.Run("when asking for the environment", func(t *testing.T) {
			o := &Orchestrator{store: &fakeStore{slugCache: map[string]string{"/wt/none": "none"}}}
			if _, err := o.StackEnv(UpParams{WorktreeDir: "/wt/none", IsLinkedWorktree: true}); err == nil {
				t.Fatal("an environment with nothing behind it must be refused, not printed empty")
			}
		})
	})
}
