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
		sel.Held, sel.Watch = held, !held
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
	sel.DevUI = true
	sel, err := o.ResolveUI(repo, sel, "bundled")
	if err != nil || !sel.BundledUI || sel.DevUI || sel.IsBuiltUI() {
		t.Fatalf("bundled should replace dev: %+v, %v", sel, err)
	}
	if sel, err = o.ResolveUI(repo, sel, "built"); err != nil || !sel.IsBuiltUI() {
		t.Fatalf("--ui=built should return to the default: %+v, %v", sel, err)
	}
	if _, err := o.ResolveUI(repo, sel, "turbo"); err == nil {
		t.Fatal("an unknown --ui value should be refused")
	}
}

// @scenario "A fresh stack serves the built UI and holds it still"
func TestBuiltUIIsTheDefaultAndHoldsWithoutWatch(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	sel := domain.DefaultSelection()
	if !sel.IsBuiltUI() || !sel.IsHeld() {
		t.Fatal("a fresh worktree should serve the built UI, held")
	}
	children := o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo)
	child, ok := findChild(children, AppLane)
	if !ok || !strings.HasPrefix(child.Shell, UIBuildShell+" && ") || !slices.Contains(child.Env, "LANGWATCH_DEV_WATCH=0") {
		t.Fatalf("want a fresh build then a host that does not reload, got %+v", child)
	}
	if _, ok := findChild(children, "ui"); ok {
		t.Fatal("a built stack without --watch runs no ui-watch lane")
	}
}

// @scenario "A built UI started with --watch rebuilds it on a change"
func TestBuiltUIWithWatchRebuildsInAWarmViteBuild(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	sel := domain.DefaultSelection()
	sel.Watch = true
	children := o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo)
	child, ok := findChild(children, AppLane)
	if !ok || !strings.HasPrefix(child.Shell, "test -f apps/ui/dist/client/index.html || (") || !strings.HasSuffix(child.Shell, BackendPackage+" dev") {
		t.Fatalf("want build-if-missing then the backend-only host, got %+v", child)
	}
	if ui, ok := findChild(children, "ui"); !ok || ui.Shell != UIWatchShell {
		t.Fatalf("a watching built stack needs the warm Vite build lane, got %+v", ui)
	}
	if _, ok := findChild(children, APILane); ok {
		t.Fatal("a built UI stack runs one Node host, not a separate api lane")
	}
}

// @scenario "A held built UI stack runs no Vite and routes the app hostname to the api"
func TestHeldBuiltUIPlansTheBackendOnlyHost(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	sel := domain.DefaultSelection()
	sel.Held = true
	children := o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo)
	child, ok := findChild(children, AppLane)
	if !ok || !strings.HasPrefix(child.Shell, UIBuildShell) || !strings.HasSuffix(child.Shell, BackendPackage+" dev") {
		t.Fatalf("want build then the backend-only host, got %+v", child)
	}
	if _, ok := findChild(children, "ui"); ok {
		t.Fatal("a held stack rebuilds the UI only on `haven reload ui`")
	}
}

// @scenario "A built UI started with --watch rebuilds it on a change"
func TestUIWatchShellSwapsEachFinishedRebuild(t *testing.T) {
	repo := t.TempDir()
	served := filepath.Join(repo, "apps", "ui", "dist", "client")
	if err := os.MkdirAll(filepath.Join(served, "assets"), 0o750); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"index.html": "v0", "assets/old.js": "old"} {
		if err := os.WriteFile(filepath.Join(served, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// A stand-in for Vite's build --watch: a good build, a failed one, a good one.
	fake := "pnpm() { for a; do case $prev in --outDir) out=apps/ui/$a;; esac; prev=$a; done; " +
		"mkdir -p $out/assets; echo v1 > $out/index.html; echo 'built in 5ms.'; sleep 0.3; " +
		"echo 'error: does not compile'; sleep 0.3; echo v2 > $out/index.html; echo 'built in 7ms.'; sleep 0.3; }\n"
	cmd := exec.Command("sh", "-c", fake+UIWatchShell)
	cmd.Dir = repo
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "vite build --watch ended") {
		t.Fatalf("a watch that ends must fail the lane so it restarts: %v\n%s", err, out)
	}
	if n := strings.Count(string(out), "ui bundle swapped in"); n != 2 || !strings.Contains(string(out), "built in 7ms.") {
		t.Fatalf("want two swaps and Vite's durations logged, got:\n%s", out)
	}
	if b, _ := os.ReadFile(filepath.Join(served, "index.html")); strings.TrimSpace(string(b)) != "v2" {
		t.Fatalf("served index.html = %q, want the last good build", b)
	}
	if _, err := os.Stat(filepath.Join(served, "assets", "old.js")); err != nil {
		t.Fatalf("an open page's old chunk was dropped: %v", err)
	}
}
