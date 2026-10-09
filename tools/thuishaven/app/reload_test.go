package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
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

// @scenario "A built UI is rebuilt beside the served one and swapped in"
func TestUIBuildShellSwapsTheBundleAndKeepsOldAssets(t *testing.T) {
	repo := t.TempDir()
	served := filepath.Join(repo, "apps", "ui", "dist", "client")
	if err := os.MkdirAll(filepath.Join(served, "assets"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(served, "assets", "old.js"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A stand-in pnpm: writes a build where `--outDir` (relative to apps/ui) says.
	fake := "pnpm() { for a; do case $prev in --outDir) out=apps/ui/$a;; esac; prev=$a; done; " +
		"mkdir -p $out/assets && echo new > $out/index.html && echo new > $out/assets/new.js; }\n"
	cmd := exec.Command("sh", "-c", fake+UIBuildShell)
	cmd.Dir = repo
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build shell failed: %v\n%s", err, out)
	}
	for _, want := range [][]string{{"index.html"}, {"assets", "new.js"}, {"assets", "old.js"}} {
		if _, err := os.Stat(filepath.Join(append([]string{served}, want...)...)); err != nil {
			t.Fatalf("served bundle lacks %v: %v", want, err)
		}
	}
	for _, gone := range []string{"client.next", "client.old"} {
		if _, err := os.Stat(filepath.Join(repo, "apps", "ui", "dist", gone)); err == nil {
			t.Fatalf("%s left behind", gone)
		}
	}
}

// @scenario "A bundled UI stack runs Vite on bundled output and leaves the other modes"
func TestBundledUISetsTheViteEnvAndIsExclusiveWithBuilt(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}, store: &fakeStore{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	sel := domain.DefaultSelection()
	sel.BundledUI = true
	children := o.planChildren(st, PlanOptions{Selection: sel, ShouldRunOneProcess: true, RepoRoot: repo}, repo)
	child, ok := findChild(children, AppLane)
	if !ok || !slices.Contains(child.Env, "LANGWATCH_UI_BUNDLED=1") {
		t.Fatalf("want LANGWATCH_UI_BUNDLED=1 on the app lane, got %+v", child)
	}
	sel.BuiltUI = true
	sel, err := o.ResolveUI(repo, sel, "bundled")
	if err != nil || !sel.BundledUI || sel.BuiltUI {
		t.Fatalf("bundled should replace built: %+v, %v", sel, err)
	}
	if _, err := o.ResolveUI(repo, sel, "turbo"); err == nil {
		t.Fatal("an unknown --ui value should be refused")
	}
}

// @scenario "A built UI stack runs no Vite and routes the app hostname to the api"
func TestBuiltUIPlansTheBackendOnlyHost(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	sel := domain.DefaultSelection()
	sel.BuiltUI = true
	children := o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo)
	child, ok := findChild(children, AppLane)
	if !ok || !strings.HasPrefix(child.Shell, UIBuildShell) || !strings.HasSuffix(child.Shell, BackendPackage+" dev") {
		t.Fatalf("want build then the backend-only host, got %+v", child)
	}
	if _, ok := findChild(children, APILane); ok {
		t.Fatal("a built UI stack runs one Node host, not a separate api lane")
	}
}
