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
func TestUIBuildShellCarriesRecentAssetsForwardAndDropsOldOnes(t *testing.T) {
	repo, served := builtUIRepo(t)
	// A chunk superseded two days ago, which the served build no longer lists.
	ancient := filepath.Join(served, "assets", "ancient.js")
	if err := os.WriteFile(ancient, []byte("ancient"), 0o600); err != nil {
		t.Fatal(err)
	}
	twoDaysAgo := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(ancient, twoDaysAgo, twoDaysAgo); err != nil {
		t.Fatal(err)
	}
	// The served build lists old.js as its own: the swap marks it superseded now, whatever its age.
	if err := os.Chtimes(filepath.Join(served, "assets", "old.js"), twoDaysAgo, twoDaysAgo); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(served, ".build-assets"), []byte("old.js\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A stale lock from a killed build must not wedge the next one.
	if err := os.WriteFile(filepath.Join(repo, "apps", "ui", "dist", "client.lock"), []byte("999999\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A stand-in for `pnpm nx run @langwatch/ui:build:local`: writes the target's fixed output.
	fake := "pnpm() { case \"$*\" in *'@langwatch/ui:build:local'*) ;; *) return 1;; esac; out=apps/ui/dist/client.local; " +
		"mkdir -p $out/assets && echo new > $out/index.html && echo new > $out/assets/new.js; }\n"
	if out, err := runShell(repo, fake+UIBuildShell); err != nil {
		t.Fatalf("build shell failed: %v\n%s", err, out)
	}
	for _, want := range [][]string{{"index.html"}, {"assets", "new.js"}, {"assets", "old.js"}} {
		if _, err := os.Stat(filepath.Join(append([]string{served}, want...)...)); err != nil {
			t.Fatalf("served bundle lacks %v: %v", want, err)
		}
	}
	if _, err := os.Stat(filepath.Join(served, "assets", "ancient.js")); err == nil {
		t.Fatal("a chunk superseded over 24 h ago was carried forward; the bundle would grow forever")
	}
	if b, _ := os.ReadFile(filepath.Join(served, ".build-assets")); string(b) != "new.js\n" {
		t.Fatalf("the swapped-in build lists %q, want only its own new.js", b)
	}
	assertNoStaging(t, repo)
}

// @scenario "A built UI is rebuilt beside the served one and swapped in"
func TestStackStartDropsEveryAssetTheServedBuildDoesNotList(t *testing.T) {
	repo, served := builtUIRepo(t)
	if err := os.WriteFile(filepath.Join(served, "assets", "current.js"), []byte("c"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(served, ".build-assets"), []byte("current.js\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := runShell(repo, uiPruneStaleShell); err != nil {
		t.Fatalf("prune failed: %v\n%s", err, out)
	}
	if _, err := os.Stat(filepath.Join(served, "assets", "current.js")); err != nil {
		t.Fatalf("the served build's own chunk was pruned: %v", err)
	}
	if _, err := os.Stat(filepath.Join(served, "assets", "old.js")); err == nil {
		t.Fatal("a stale chunk survived stack start")
	}
}

// @scenario "A built UI is rebuilt beside the served one and swapped in"
func TestUIBuildShellKeepsTheLastGoodBundleWhenTheBuildFails(t *testing.T) {
	repo, served := builtUIRepo(t)
	if _, err := runShell(repo, "pnpm() { return 1; }\n"+UIBuildShell); err == nil {
		t.Fatal("a failed build should fail the shell")
	}
	if _, err := os.Stat(filepath.Join(served, "assets", "old.js")); err != nil {
		t.Fatalf("a failed build replaced the served bundle: %v", err)
	}
	assertNoStaging(t, repo)
}

func builtUIRepo(t *testing.T) (repo, served string) {
	t.Helper()
	repo = t.TempDir()
	served = filepath.Join(repo, "apps", "ui", "dist", "client")
	if err := os.MkdirAll(filepath.Join(served, "assets"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(served, "assets", "old.js"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	return repo, served
}

func runShell(dir, script string) ([]byte, error) {
	cmd := exec.Command("sh", "-c", script)
	cmd.Dir = dir
	return cmd.CombinedOutput()
}

// assertNoStaging: no per-pid staging, Nx output or lock is left beside the served bundle.
func assertNoStaging(t *testing.T, repo string) {
	t.Helper()
	left, _ := filepath.Glob(filepath.Join(repo, "apps", "ui", "dist", "client.*"))
	if len(left) > 0 {
		t.Fatalf("staging left behind: %v", left)
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
	sel.WatchUI, sel.BundledUI = true, false
	sel, err := o.ResolveUI(repo, sel, "bundled")
	if err != nil || !sel.BundledUI || sel.WatchUI || sel.IsBuiltUI() {
		t.Fatalf("bundled should replace watch: %+v, %v", sel, err)
	}
	if sel, err = o.ResolveUI(repo, sel, "watch"); err != nil || !sel.WatchUI || sel.BundledUI || !sel.IsBuiltUI() || sel.IsHeld() {
		t.Fatalf("--ui=watch should serve the built UI and refresh it: %+v, %v", sel, err)
	}
	if sel, err = o.ResolveUI(repo, sel, "built"); err != nil || !sel.IsBuiltUI() || sel.WatchUI {
		t.Fatalf("--ui=built should return to the default: %+v, %v", sel, err)
	}
	if _, err := o.ResolveUI(repo, sel, "turbo"); err == nil {
		t.Fatal("an unknown --ui value should be refused")
	}
	if _, err := o.ResolveUI(repo, sel, "dev"); err == nil || !strings.Contains(err.Error(), "pnpm dev") {
		t.Fatalf("--ui=dev left haven and should point at `pnpm dev`, got %v", err)
	}
}

// @scenario "A fresh stack serves the built UI and holds it still"
func TestBuiltUIIsTheDefaultAndHoldsWithoutWatch(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), UIWatchArgv: []string{"/opt/haven", "ui-watch"}}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	sel := domain.DefaultSelection()
	if !sel.IsBuiltUI() || !sel.IsHeld() {
		t.Fatal("a fresh worktree should serve the built UI, held")
	}
	children := o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo)
	child, ok := findChild(children, AppLane)
	if !ok || !strings.HasPrefix(child.Shell, uiPruneStaleShell+"("+UIBuildShell+") && ") || !slices.Contains(child.Env, "LANGWATCH_DEV_WATCH=0") {
		t.Fatalf("want a fresh build then a host that does not reload, got %+v", child)
	}
	if _, ok := findChild(children, "ui"); ok {
		t.Fatal("a built stack runs no ui-watch lane")
	}
	sel.Watch = true // --watch reloads the backend; only --ui=watch rebuilds the UI
	if _, ok := findChild(o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo), "ui"); ok {
		t.Fatal("a built stack with --watch still runs no ui-watch lane")
	}
}

// @scenario "A watch UI stack rebuilds the built UI on a change"
func TestWatchUIRebuildsWithOneShotBuilds(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), UIWatchArgv: []string{"/opt/haven", "ui-watch"}}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	sel := domain.DefaultSelection()
	sel.WatchUI = true
	children := o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo)
	child, ok := findChild(children, AppLane)
	if !ok || !strings.HasPrefix(child.Shell, uiPruneStaleShell+"("+UIBuildShell+") && ") || !strings.HasSuffix(child.Shell, BackendPackage+" dev") {
		t.Fatalf("want a build at start then the backend-only host, got %+v", child)
	}
	if !slices.Contains(child.Env, "LANGWATCH_UI_WATCH=1") || slices.Contains(child.Env, "LANGWATCH_DEV_WATCH=0") {
		t.Fatalf("a watch UI host marks its pages and reloads on a change, got %v", child.Env)
	}
	if ui, ok := findChild(children, "ui"); !ok || ui.Shell != "exec '/opt/haven' 'ui-watch'" {
		t.Fatalf("a watching built stack needs the haven ui-watch lane, got %+v", ui)
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
	if !ok || !strings.HasPrefix(child.Shell, uiPruneStaleShell+"("+UIBuildShell+") && ") || !strings.HasSuffix(child.Shell, BackendPackage+" dev") {
		t.Fatalf("want build then the backend-only host, got %+v", child)
	}
	if _, ok := findChild(children, "ui"); ok {
		t.Fatal("a held stack rebuilds the UI only on `haven reload ui`")
	}
}
