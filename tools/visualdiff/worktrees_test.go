package visualdiff

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// @scenario "Each side reuses one worktree between runs and prepares it only when its tree changed"
func TestEachSideReusesOneWorktreeBetweenRuns(t *testing.T) {
	options, fake, deps := cachingRun(t)
	options.Baseline = false
	var detached []string
	deps.Detach = func(spec commandSpec, _ string) error {
		detached = append(detached, haventArgv(spec))
		return nil
	}
	execute := func(runDir string) Result {
		t.Helper()
		again := options
		again.RunDir = runDir
		result, err := Execute(context.Background(), Request{Options: again, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})
		if err != nil {
			t.Fatalf("Execute: %v", err)
		}
		return result
	}
	base := PersistentWorktree(options.Root, "base")
	fake.haven.readyStacks["visualdiff-run2-base"] = "https://app.visualdiff-run2-base.langwatch.localhost"

	first := execute(filepath.Join(options.Root, ".visualdiff", "run"))
	if first.Plan.Base.Dir != base || !first.Plan.Base.Persistent {
		t.Fatalf("the base checked out into %s, want its persistent worktree %s", first.Plan.Base.Dir, base)
	}
	if got := fake.matching("worktree add --force --detach " + base); len(got) != 1 {
		t.Fatalf("the first run adds the persistent worktree once: %v", fake.commands)
	}
	if len(fake.matching("pnpm install")) != 2 {
		t.Fatalf("the first run prepares both sides: %v", fake.commands)
	}
	if len(fake.matching("worktree remove")) != 0 || len(detached) != 2 {
		t.Fatalf("teardown removes no persistent worktree and destroys both stacks in the background: removes %v, detached %v",
			fake.matching("worktree remove"), detached)
	}

	for _, side := range []string{"base", "candidate"} {
		if err := os.MkdirAll(PersistentWorktree(options.Root, side), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(PersistentWorktree(options.Root, side), ".git"), []byte("gitdir: x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(PersistentWorktree(options.Root, side), "node_modules"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(PersistentWorktree(options.Root, side), "node_modules", ".modules.yaml"), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	lock := filepath.Join(PersistentWorktree(options.Root, "candidate"), "sdks", "typescript", "node_modules", ".ensure-built.lock")
	if err := os.MkdirAll(lock, 0o750); err != nil {
		t.Fatal(err)
	}
	fake.commands = nil
	execute(filepath.Join(options.Root, ".visualdiff", "run2"))
	if got := fake.matching("checkout --detach --force " + testBaseCommit); len(got) != 2 {
		t.Errorf("the second run moves both worktrees in place: %v", fake.commands)
	}
	if got := fake.matching("worktree add"); len(got) != 0 {
		t.Errorf("the second run added a worktree again: %v", got)
	}
	if got := fake.matching("pnpm install"); len(got) != 0 {
		t.Errorf("an unchanged lockfile was installed again: %v", got)
	}
	if got := fake.matching("start:prepare:files"); len(got) != 0 {
		t.Errorf("unchanged code had its generated files written again: %v", got)
	}
	if got := fake.matching("ensure-built.mjs"); len(got) != 2 {
		t.Errorf("ensure-built, which checks itself, runs every time: %v", got)
	}
	if dirExists(lock) {
		t.Error("a stale ensure-built lock was left for the build to wait 180s on")
	}

	fake.commands, fake.lock = nil, "changed"
	fake.haven.readyStacks["visualdiff-run3-base"] = "https://app.visualdiff-run3-base.langwatch.localhost"
	fake.haven.readyStacks["visualdiff-run3-candidate"] = "https://app.visualdiff-run3-candidate.langwatch.localhost"
	execute(filepath.Join(options.Root, ".visualdiff", "run3"))
	if got := fake.matching("pnpm install"); len(got) != 2 {
		t.Errorf("a changed lockfile must install again on both sides: %v", got)
	}

	states, err := ScanRuns(options.Root, func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range states {
		if state.Name == WorktreesDir {
			t.Errorf("gc reads the persistent worktrees as a run it may collect")
		}
	}
}

// @scenario "Each side reuses one worktree between runs and prepares it only when its tree changed"
func TestAWorktreeAnotherLiveRunHoldsIsNotShared(t *testing.T) {
	root := t.TempDir()
	holder := filepath.Join(root, ".visualdiff", "holder")
	if err := os.MkdirAll(holder, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(holder, RunPIDFile), []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := claimWorktree(root, holder, "base"); err != nil {
		t.Fatal(err)
	}

	mine := filepath.Join(root, ".visualdiff", "mine")
	dir, persistent, err := claimWorktree(root, mine, "base")

	if err != nil || persistent || dir != filepath.Join(mine, "base") {
		t.Fatalf("got %s persistent=%t err=%v, want a worktree of this run's own", dir, persistent, err)
	}
	if err := os.Remove(filepath.Join(holder, RunPIDFile)); err != nil {
		t.Fatal(err)
	}
	if dir, persistent, _ := claimWorktree(root, mine, "base"); !persistent || dir != PersistentWorktree(root, "base") {
		t.Errorf("a finished holder still kept the worktree: %s", dir)
	}
}

// @scenario "The candidate captures while the base is still booting"
func TestTheCandidateCapturesWhileTheBaseIsStillBooting(t *testing.T) {
	options, _, deps := cachingRun(t)
	options.Baseline, options.Editions = false, []Edition{EditionEnterprise}
	deps.Seed = func(_ context.Context, request SeedRequest) (SeedResult, error) {
		return SeedResult{Fixtures: map[string]string{"dataset": "ds_" + request.APIURL}}, nil
	}
	var handed RunnerPlan
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		handed = plan
		return RunnerStream{}, nil
	}

	result, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	pending := filepath.Join(options.RunDir, PendingBaseFile)
	if handed.Sides[0].Pending != pending || handed.Sides[0].BaseURL != "" {
		t.Fatalf("the base side must arrive through its pending file: %+v", handed.Sides[0])
	}
	written, err := os.ReadFile(pending)
	if err != nil || !strings.Contains(string(written), "visualdiff-run-base") {
		t.Fatalf("the pending file names the base's address: %s (%v)", written, err)
	}
	if result.Plan.Base.HavenURL == "" {
		t.Error("the run never adopted the base's address for its report")
	}
	marker, err := os.ReadFile(filepath.Join(options.RunDir, "seeded"))
	if err != nil || !strings.Contains(string(marker), `"base"`) || !strings.Contains(string(marker), `"candidate"`) {
		t.Errorf("the seed marker must hold both sides' fixtures: %s (%v)", marker, err)
	}
}
