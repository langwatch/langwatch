package visualdiff

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// @scenario "gc leaves a live run, a kept run and the run doing the collecting"
func TestGCLeavesALiveRunAKeptRunAndTheCurrentRun(t *testing.T) {
	states := []RunState{
		{Name: "20260926-111129", Dir: "/r/.visualdiff/20260926-111129", Alive: true},
		{Name: "20260926-133653", Dir: "/r/.visualdiff/20260926-133653", Kept: true},
		{Name: "20260928-000000", Dir: "/r/.visualdiff/20260928-000000"},
	}
	live, kept := HavenSlug(RunID(states[0].Dir), "base"), HavenSlug(RunID(states[1].Dir), "candidate")

	plan := SelectGarbage(states, GCSelection{Current: "/r/.visualdiff/20260928-000000", Registered: []string{live, kept}})

	if len(plan.Runs) != 0 || len(plan.OrphanSlugs) != 0 {
		t.Fatalf("nothing is stale: %+v", plan)
	}
	if withKept := SelectGarbage(states, GCSelection{Current: states[2].Dir, IncludeKept: true}); len(withKept.Runs) != 1 || withKept.Runs[0].State.Name != states[1].Name {
		t.Fatalf("-kept removes the kept run: %+v", withKept)
	}
}

// @scenario "A run keeps its own directory and the previous run's, and deletes the rest"
func TestARunKeepsOnlyThePreviousRunsDirectory(t *testing.T) {
	root := t.TempDir()
	current := filepath.Join(root, ".visualdiff", "20260929-120000")
	for _, name := range []string{"20260926-111129", "20260927-134222", "20260928-090000", "20260929-120000", "handmade"} {
		if err := os.MkdirAll(filepath.Join(root, ".visualdiff", name, "candidate"), 0o750); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, ".visualdiff", "20260926-111129", RunKeepFile), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".visualdiff", BaselinesDir, "key"), 0o750); err != nil {
		t.Fatal(err)
	}
	states, err := ScanRuns(root, func(int) bool { return false })
	if err != nil || len(states) != 5 {
		t.Fatalf("the baseline cache is not a run: %+v %v", states, err)
	}

	plan := SelectGarbage(states, GCSelection{Current: current, KeepRuns: RetainedRuns})

	removed := map[string]bool{}
	for _, run := range plan.Runs {
		removed[run.State.Name] = run.RemoveDir
		if len(run.State.Worktrees) != 1 {
			t.Errorf("a dead run still loses its worktree: %+v", run.State)
		}
	}
	if _, collected := removed["20260929-120000"]; collected {
		t.Error("the current run collected itself")
	}
	if removed["20260928-090000"] {
		t.Error("the previous run's directory was removed")
	}
	if !removed["20260927-134222"] {
		t.Error("a run older than the previous one kept its directory")
	}
	if _, collected := removed["20260926-111129"]; collected {
		t.Error("a kept run was collected")
	}
	if removed["handmade"] {
		t.Error("a directory not named as a run was removed")
	}
}

// @scenario "visualdiff gc removes only reports older than -older-than"
func TestGCRemovesOnlyOldReports(t *testing.T) {
	states := []RunState{
		{Name: "20260901-000000", Dir: "/r/.visualdiff/20260901-000000"},
		{Name: "20260928-120000", Dir: "/r/.visualdiff/20260928-120000"},
		{Name: "handmade", Dir: "/r/.visualdiff/handmade"},
	}
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.Local)

	plan := SelectGarbage(states, GCSelection{RemoveOlderThan: 7 * 24 * time.Hour, Now: now})

	removed := map[string]bool{}
	for _, run := range plan.Runs {
		removed[run.State.Name] = run.RemoveDir
	}
	if !removed["20260901-000000"] || removed["20260928-120000"] || removed["handmade"] {
		t.Fatalf("only the run older than a week loses its directory: %+v", removed)
	}
}

// @scenario "gc destroys orphan visualdiff stacks no run owns"
func TestGCDestroysOrphanStacksThenPrunes(t *testing.T) {
	root := t.TempDir()
	dead := filepath.Join(root, ".visualdiff", "20260926-111129")
	if err := os.MkdirAll(filepath.Join(dead, "base"), 0o750); err != nil {
		t.Fatal(err)
	}
	var commands []string
	run := func(_ context.Context, spec commandSpec, out io.Writer) error {
		commands = append(commands, spec.name+" "+strings.Join(spec.args, " "))
		if len(spec.args) > 0 && spec.args[0] == "status" {
			_, _ = io.WriteString(out, `{"stacks":[{"slug":"visualdiff-20260901-000000-base"},{"slug":"feat-x"}]}`)
		}
		return nil
	}
	var out bytes.Buffer

	err := CollectGarbage(context.Background(), GCRequest{
		Root: root, UseHaven: true, Run: run, Environ: func() []string { return nil }, Alive: func(int) bool { return false }, Out: &out,
	})

	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(commands, "\n")
	for _, want := range []string{
		"haven destroy visualdiff-20260926-111129-base --agent --yes",
		"git worktree remove --force " + filepath.Join(dead, "base"),
		"haven destroy visualdiff-20260901-000000-base --agent --yes",
	} {
		mustContain(t, joined, want)
	}
	if strings.Contains(joined, "destroy feat-x") {
		t.Fatal("a developer's own stack is never an orphan")
	}
	if commands[len(commands)-1] != "git worktree prune" {
		t.Fatalf("prune runs last: %v", commands)
	}
	if _, err := os.Stat(filepath.Join(dead, "base")); err == nil {
		t.Fatal("the worktree directory is gone")
	}
	mustContain(t, out.String(), "gc: stale run 20260926-111129")
}
