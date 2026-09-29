package apidiff

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/havenrun"
)

func alwaysAlive(int) bool { return true }
func neverAlive(int) bool  { return false }

func TestAPersistentWorktreeIsSharedOnlyWithRunsThatNoLongerNeedIt(t *testing.T) {
	root := t.TempDir()
	holder := worktreeHolder{workRoot: filepath.Join(root, ".apidiff", "earlier"), pid: 4242}
	if err := os.MkdirAll(holder.workRoot, 0o750); err != nil {
		t.Fatal(err)
	}
	me := worktreeHolder{workRoot: filepath.Join(root, ".apidiff", "mine"), pid: os.Getpid()}
	cases := []struct {
		name       string
		holder     *worktreeHolder
		alive      func(int) bool
		persistent bool
	}{
		{name: "nobody holds it", alive: alwaysAlive, persistent: true},
		{name: "a live run holds it", holder: &holder, alive: alwaysAlive},
		{name: "a finished run held it", holder: &holder, alive: neverAlive, persistent: true},
		{name: "a kept run holds it", holder: &worktreeHolder{workRoot: holder.workRoot, pid: 4242, keep: true}, alive: neverAlive},
		{name: "the holder's work root is gone", holder: &worktreeHolder{workRoot: filepath.Join(root, "gone"), pid: 4242}, alive: alwaysAlive, persistent: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			dir := persistentWorktree(root, "main")
			_ = os.Remove(dir + worktreeOwnerSuffix)
			if testCase.holder != nil {
				if err := os.MkdirAll(filepath.Dir(dir), 0o750); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(dir+worktreeOwnerSuffix, []byte(testCase.holder.render()), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			got, persistent, err := worktreeClaim{root: root, side: "main", me: me, alive: testCase.alive}.claim()
			if err != nil {
				t.Fatal(err)
			}
			if persistent != testCase.persistent {
				t.Fatalf("persistent = %t, want %t (dir %s)", persistent, testCase.persistent, got)
			}
			if !persistent {
				if got != filepath.Join(me.workRoot, "main") {
					t.Errorf("a held worktree must fall back to the run's own, got %s", got)
				}
				return
			}
			if owner, _ := readWorktreeHolder(dir); owner.workRoot != me.workRoot || owner.pid != me.pid {
				t.Errorf("owner = %+v, want this run", owner)
			}
			releaseWorktree(dir, me.workRoot)
			if _, err := os.Stat(dir + worktreeOwnerSuffix); err == nil {
				t.Error("release must hand the worktree to the next run")
			}
		})
	}
}

// gitAnswers answers rev-parse with a fixed commit and tree, and records
// every command; a worktree add also makes its directory a worktree.
type gitAnswers struct {
	recordingRunner
	tree string
}

func (answers *gitAnswers) run(ctx context.Context, spec commandSpec, log io.Writer) error {
	answers.commands = append(answers.commands, spec)
	if spec.name != "git" || len(spec.args) == 0 {
		return nil
	}
	switch {
	case spec.args[0] == "rev-parse" && strings.HasSuffix(spec.args[len(spec.args)-1], "^{tree}"):
		_, err := io.WriteString(log, answers.tree+"\n")
		return err
	case spec.args[0] == "rev-parse":
		_, err := io.WriteString(log, "c0ffee\n")
		return err
	case spec.args[0] == "worktree" && spec.args[1] == "add":
		dir := spec.args[len(spec.args)-2]
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dir, ".git"), []byte("gitdir: elsewhere\n"), 0o600)
	}
	return nil
}

func (answers *gitAnswers) git() []string {
	var lines []string
	for _, spec := range answers.commands {
		if spec.name == "git" && spec.args[0] != "rev-parse" {
			lines = append(lines, strings.Join(spec.args, " "))
		}
	}
	return lines
}

// @scenario "Each side reuses one worktree between runs and prepares it only when its tree changed"
func TestAPersistentWorktreeIsAddedOnceThenMovedToEachRunsCommit(t *testing.T) {
	root := t.TempDir()
	answers := &gitAnswers{tree: "tree-1"}
	dir := persistentWorktree(root, "main")
	first := &bootState{cfg: BootConfig{BranchDir: root}, stderr: io.Discard, run: answers.run, workRoot: filepath.Join(root, ".apidiff", "one")}
	checkout, err := first.checkOut(context.Background(), "main", "origin/main")
	if err != nil {
		t.Fatal(err)
	}
	if !checkout.persistent || checkout.owned || checkout.dir != dir || checkout.tree != "tree-1" {
		t.Fatalf("first checkout = %+v", checkout)
	}
	want := "worktree prune\nworktree add --force --detach " + dir + " c0ffee"
	if got := strings.Join(answers.git(), "\n"); got != want {
		t.Errorf("first run ran\n%s\nwant\n%s", got, want)
	}
	if err := os.MkdirAll(filepath.Join(dir, "platform", "app"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, overlayEnvFile), []byte("DATABASE_URL=dropped\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	first.releaseCheckouts(context.Background())
	if _, err := os.Stat(filepath.Join(dir, overlayEnvFile)); !errors.Is(err, os.ErrNotExist) {
		t.Error("release must delete the env overlay: the next stack in this directory would read the dropped database")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Error("release must leave the persistent worktree in place")
	}

	answers.commands = nil
	second := &bootState{cfg: BootConfig{BranchDir: root}, stderr: io.Discard, run: answers.run, workRoot: filepath.Join(root, ".apidiff", "two")}
	if _, err := second.checkOut(context.Background(), "main", "origin/main"); err != nil {
		t.Fatal(err)
	}
	want = "-C " + dir + " checkout --detach --force c0ffee"
	if got := strings.Join(answers.git(), "\n"); got != want {
		t.Errorf("second run ran\n%s\nwant\n%s", got, want)
	}
}

func TestAPersistentWorktreeIsPreparedOnlyWhenItsTreeChanged(t *testing.T) {
	root := t.TempDir()
	dir := persistentWorktree(root, "main")
	monolithTree(t, dir)
	recorder := &prepareRecorder{}
	prepare := func(tree string) int {
		state := &bootState{cfg: BootConfig{BranchDir: root}, stderr: &lockedWriter{out: io.Discard}, run: recorder.run}
		state.checkouts = []sideCheckout{{side: "main", dir: dir, persistent: true, tree: tree}}
		before := len(recorder.commands)
		if err := state.prepareTree(context.Background(), runSide{name: "main", dir: dir}); err != nil {
			t.Fatal(err)
		}
		return len(recorder.commands) - before
	}
	steps := len(havenrun.PrepareCommands(havenrun.LayoutMonolith))
	if ran := prepare("tree-1"); ran != steps {
		t.Fatalf("a fresh worktree ran %d prepare steps, want %d", ran, steps)
	}
	if ran := prepare("tree-1"); ran != 0 {
		t.Errorf("an unchanged tree ran %d prepare steps, want none", ran)
	}
	if ran := prepare("tree-2"); ran != steps {
		t.Errorf("a moved tree ran %d prepare steps, want %d", ran, steps)
	}
}

func TestAWorktreeAnotherRunHeldIsDiscardedInTheBackground(t *testing.T) {
	root := t.TempDir()
	workRoot := filepath.Join(root, ".apidiff", "run")
	own := filepath.Join(workRoot, "main")
	if err := os.MkdirAll(own, 0o750); err != nil {
		t.Fatal(err)
	}
	recorder := &recordingRunner{}
	var detached []string
	state := &bootState{
		cfg: BootConfig{BranchDir: root}, stderr: io.Discard, run: recorder.run, workRoot: workRoot,
		checkouts: []sideCheckout{{side: "main", dir: own, owned: true}},
		detach: func(spec commandSpec, _ string) error {
			detached = append(detached, spec.name+" "+strings.Join(spec.args, " "))
			return nil
		},
	}
	state.teardown()
	if _, err := os.Stat(own); err == nil {
		t.Error("the run's own worktree must be moved aside at once")
	}
	if got, want := strings.Join(detached, "\n"), "rm -rf "+own+".discarded"; got != want {
		t.Errorf("detached %q, want %q", got, want)
	}
	if len(recorder.commands) != 1 || argv(recorder.commands[0]) != "git worktree prune" {
		t.Errorf("teardown ran %v, want only git worktree prune", recorder.commands)
	}
}

// @scenario "The compose stack stays up between runs"
func TestTheComposeStackStaysUpForTheNextRun(t *testing.T) {
	root := t.TempDir()
	recorder := &recordingRunner{}
	first := &bootState{cfg: BootConfig{BranchDir: root, ComposeProject: "apidiff"}, stderr: io.Discard, run: recorder.run, workRoot: root}
	if err := first.resolveInfra(); err != nil {
		t.Fatal(err)
	}
	if first.reusedPorts {
		t.Fatal("the first run has no ports to reuse")
	}
	second := &bootState{cfg: BootConfig{BranchDir: root, ComposeProject: "apidiff"}, stderr: io.Discard, run: recorder.run, workRoot: root}
	if err := second.resolveInfra(); err != nil {
		t.Fatal(err)
	}
	if !second.reusedPorts || second.infra.pgPort != first.infra.pgPort || second.infra.chPort != first.infra.chPort || second.infra.redisPort != first.infra.redisPort {
		t.Fatalf("the second run must find the first run's ports: %+v vs %+v", second.infra, first.infra)
	}
	second.infra.chServer, second.infra.redisServer = "http://127.0.0.1:1", "redis://127.0.0.1:1"
	second.teardownInfra(context.Background())
	for _, spec := range recorder.commands {
		if joined := strings.Join(spec.args, " "); strings.Contains(joined, " down") {
			t.Errorf("teardown took the compose stack down: %s", argv(spec))
		}
	}
	if !recorder.ran("docker") {
		t.Error("teardown must still drop the run's databases on the compose stack")
	}
}

func TestComposeUpOnStalePortsRetriesOnFreshOnes(t *testing.T) {
	root := t.TempDir()
	path := composeOverridePath(root, "apidiff")
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(portsOverrideYAML(1, 2, 3)), 0o600); err != nil {
		t.Fatal(err)
	}
	ups := 0
	state := &bootState{cfg: BootConfig{BranchDir: root, ComposeProject: "apidiff"}, stderr: io.Discard, workRoot: root}
	state.run = func(_ context.Context, spec commandSpec, _ io.Writer) error {
		if ups++; ups == 1 {
			return errors.New("port is already allocated")
		}
		return nil
	}
	if err := state.resolveInfra(); err != nil {
		t.Fatal(err)
	}
	if err := state.startInfra(context.Background()); err != nil {
		t.Fatalf("startInfra: %v", err)
	}
	if ups != 2 || state.infra.pgPort == 1 || state.reusedPorts {
		t.Errorf("ups=%d pg=%d reused=%t, want a second up on fresh ports", ups, state.infra.pgPort, state.reusedPorts)
	}
	if ports, ok := readOverridePorts(path); !ok || ports[0] != state.infra.pgPort {
		t.Errorf("the override must record the fresh ports, got %v", ports)
	}
}

// @scenario "A side's inventories are read once per tree"
func TestAnInventoryIsReadOncePerTree(t *testing.T) {
	root, work := t.TempDir(), t.TempDir()
	cache := inventoryCache{dir: filepath.Join(root, "cache")}
	outFiles := map[string]string{"trpc": filepath.Join(work, "trpc-main.json"), "routes": filepath.Join(work, "routes-main.json")}
	for kind, path := range outFiles {
		if err := os.WriteFile(path, []byte(`{"side":"`+kind+`"}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if inventoryCacheKey("") != "" {
		t.Fatal("an unknown tree must cache nothing")
	}
	first, second := inventoryCacheKey("tree-1"), inventoryCacheKey("tree-2")
	if first == "" || first == second {
		t.Fatalf("keys %q and %q must differ per tree", first, second)
	}
	if cache.restore("main", first, outFiles) {
		t.Fatal("an empty cache restored an inventory")
	}
	if err := cache.store("main", first, outFiles); err != nil {
		t.Fatal(err)
	}
	restored := map[string]string{"trpc": filepath.Join(work, "again-trpc.json"), "routes": filepath.Join(work, "again-routes.json")}
	if !cache.restore("main", first, restored) {
		t.Fatal("the stored inventory was not restored")
	}
	if content, _ := os.ReadFile(restored["routes"]); string(content) != `{"side":"routes"}` {
		t.Errorf("restored routes = %s", content)
	}
	if err := cache.store("main", second, outFiles); err != nil {
		t.Fatal(err)
	}
	if cache.restore("main", first, restored) {
		t.Error("storing a newer tree must drop the side's older one")
	}
}

func TestTheDryRunNamesThePersistentWorktrees(t *testing.T) {
	invoking := t.TempDir()
	plan, err := PlanBoot(BootConfig{MainRef: "origin/main", BranchDir: invoking, BranchHead: true})
	if err != nil {
		t.Fatal(err)
	}
	if plan.MainDir != persistentWorktree(invoking, "main") || plan.BranchDir != persistentWorktree(invoking, "branch") {
		t.Errorf("plan dirs = %s / %s", plan.MainDir, plan.BranchDir)
	}
	inPlace, err := PlanBoot(BootConfig{MainRef: "origin/main", BranchDir: invoking})
	if err != nil {
		t.Fatal(err)
	}
	if inPlace.BranchDir != invoking || inPlace.BranchHead {
		t.Errorf("without -branch-head the branch boots in place, got %s", inPlace.BranchDir)
	}
}
