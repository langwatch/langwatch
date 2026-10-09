package app

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "Reload waits for the host to finish, not for a pause"
func TestWaitForLineSeesOnlyNewOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.log")
	old := `{"msg":"backend ready"}` + "\n"
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := waitForLine(context.Background(), logWait{path, int64(len(old)), doneLines, 300 * time.Millisecond}); err == nil {
		t.Fatal("an old ready line must not count")
	}
	go func() {
		time.Sleep(100 * time.Millisecond)
		f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
		_, _ = f.WriteString(old)
		_ = f.Close()
	}()
	if err := waitForLine(context.Background(), logWait{path, int64(len(old)), doneLines, 5 * time.Second}); err != nil {
		t.Fatalf("new ready line missed: %v", err)
	}
}

// @scenario "A held stack runs its Node host without a backend reload on change"
func TestHeldStackSetsWatchOffOnTheNodeLane(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	for _, held := range []bool{false, true} {
		sel := domain.DefaultSelection()
		sel.Held = held
		children := o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo, ShouldRunOneProcess: true}, repo)
		child, ok := findChild(children, AppLane)
		if !ok {
			t.Fatalf("no app lane with held=%v", held)
		}
		if got := slices.Contains(child.Env, "LANGWATCH_DEV_WATCH=0"); got != held {
			t.Fatalf("held=%v but LANGWATCH_DEV_WATCH=0 present=%v", held, got)
		}
	}
}
