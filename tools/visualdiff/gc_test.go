package visualdiff

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
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

// @scenario "The newest dead run keeps its report"
func TestTheNewestDeadRunKeepsItsReport(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"20260926-111129", "20260926-134222"} {
		if err := os.MkdirAll(filepath.Join(root, ".visualdiff", name, "candidate"), 0o750); err != nil {
			t.Fatal(err)
		}
		dead := strconv.Itoa(99999999)
		if err := os.WriteFile(filepath.Join(root, ".visualdiff", name, RunPIDFile), []byte(dead), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, ".visualdiff", BaselinesDir, "key"), 0o750); err != nil {
		t.Fatal(err)
	}
	states, err := ScanRuns(root, func(int) bool { return false })
	if err != nil || len(states) != 2 {
		t.Fatalf("the baseline cache is not a run: %+v %v", states, err)
	}

	plan := SelectGarbage(states, GCSelection{})

	if len(plan.Runs) != 2 || plan.Runs[0].State.Name != "20260926-134222" || plan.Runs[0].RemoveDir || !plan.Runs[1].RemoveDir {
		t.Fatalf("only the older run loses its directory: %+v", plan.Runs)
	}
	if len(plan.Runs[0].State.Worktrees) != 1 {
		t.Fatalf("the newest run still loses its worktree: %+v", plan.Runs[0].State)
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
