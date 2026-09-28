package visualdiff

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// RunPIDFile holds the pid of the process driving a run; it is removed when
// the run ends, so a run directory without a live pid is finished or dead.
const RunPIDFile = "pid"

// RunKeepFile marks a -keep run: its stacks stay up for recapture and -resume,
// and gc leaves it alone unless asked (-kept).
const RunKeepFile = "keep"

// RunState is one .visualdiff/<run> directory as gc finds it.
type RunState struct {
	Name      string
	Dir       string
	Alive     bool
	Kept      bool
	Worktrees []string
}

// Slugs are the haven stacks a run of this directory would have started.
func (state RunState) Slugs() []string {
	runID := RunID(state.Dir)
	return []string{HavenSlug(runID, "base"), HavenSlug(runID, "candidate")}
}

// GCRun is one stale run and what gc does to it. The newest stale run keeps
// its directory - its report is the last one a person may still be reading -
// and loses only its worktrees and stacks.
type GCRun struct {
	State     RunState
	RemoveDir bool
}

// GCPlan is everything one gc pass removes.
type GCPlan struct {
	Runs        []GCRun
	OrphanSlugs []string
}

// GCSelection is what a gc pass may touch.
type GCSelection struct {
	// Current is the run directory of the run doing the collecting, never collected.
	Current     string
	IncludeKept bool
	// Registered are the haven slugs haven reports, for orphan detection.
	Registered []string
}

// SelectGarbage decides a gc pass from the run directories found. A run is
// stale when no live process drives it and it is not a kept run (unless
// IncludeKept). A registered visualdiff slug no protected run owns is an orphan.
func SelectGarbage(states []RunState, selection GCSelection) GCPlan {
	sorted := append([]RunState(nil), states...)
	sort.Slice(sorted, func(a, b int) bool { return sorted[a].Name > sorted[b].Name })
	plan := GCPlan{}
	owned := map[string]bool{}
	for _, state := range sorted {
		for _, slug := range state.Slugs() {
			owned[slug] = true
		}
		if !selection.protects(state) {
			plan.Runs = append(plan.Runs, GCRun{State: state, RemoveDir: len(plan.Runs) > 0})
		}
	}
	for _, slug := range selection.Registered {
		if strings.HasPrefix(slug, havenSlugPrefix+"-") && !owned[slug] {
			plan.OrphanSlugs = append(plan.OrphanSlugs, slug)
		}
	}
	sort.Strings(plan.OrphanSlugs)
	return plan
}

// protects reports a run gc must leave: the current one, a live one, a kept one.
func (selection GCSelection) protects(state RunState) bool {
	current := selection.Current != "" && filepath.Clean(state.Dir) == filepath.Clean(selection.Current)
	return current || state.Alive || (state.Kept && !selection.IncludeKept)
}

// ScanRuns reads every run directory under <root>/.visualdiff, skipping the
// baseline cache.
func ScanRuns(root string, alive func(pid int) bool) ([]RunState, error) {
	parent := filepath.Join(root, ".visualdiff")
	entries, err := os.ReadDir(parent)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var states []RunState
	for _, entry := range entries {
		if entry.IsDir() && entry.Name() != BaselinesDir {
			states = append(states, readRunState(filepath.Join(parent, entry.Name()), alive))
		}
	}
	return states, nil
}

func readRunState(dir string, alive func(pid int) bool) RunState {
	state := RunState{Name: filepath.Base(dir), Dir: dir, Kept: exists(filepath.Join(dir, RunKeepFile))}
	if pid, ok := readPID(dir); ok {
		state.Alive = alive(pid)
	}
	for _, stack := range []string{"base", "candidate"} {
		if exists(filepath.Join(dir, stack)) {
			state.Worktrees = append(state.Worktrees, filepath.Join(dir, stack))
		}
	}
	return state
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readPID(dir string) (int, bool) {
	content, err := os.ReadFile(filepath.Join(dir, RunPIDFile)) // #nosec G304 -- this tool's own run directory.
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(content)))
	return pid, err == nil && pid > 0
}

// ProcessAlive reports whether a pid names a running process.
func ProcessAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// MarkRun writes the run's pid (and keep marker) and returns the function
// that clears the pid when the run ends.
func MarkRun(runDir string, keep bool) (func(), error) {
	if err := os.MkdirAll(runDir, 0o750); err != nil {
		return func() {}, err
	}
	pidPath := filepath.Join(runDir, RunPIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600); err != nil {
		return func() {}, err
	}
	if keep {
		if err := os.WriteFile(filepath.Join(runDir, RunKeepFile), nil, 0o600); err != nil {
			return func() {}, err
		}
	}
	return func() { _ = os.Remove(pidPath) }, nil
}

// GCRequest is one gc pass.
type GCRequest struct {
	Root        string
	Current     string
	IncludeKept bool
	UseHaven    bool
	Run         runner
	Environ     func() []string
	Alive       func(pid int) bool
	Out         io.Writer
}

// CollectGarbage prints what it removes, then removes it: each stale run's
// haven stacks (and with them its databases), its worktrees, then its
// directory; every orphan visualdiff stack; then `git worktree prune`.
// Best-effort: one thing that will not go never stops the rest.
func CollectGarbage(ctx context.Context, request GCRequest) error {
	request = request.filled()
	states, err := ScanRuns(request.Root, request.Alive)
	if err != nil {
		return fmt.Errorf("gc: %w", err)
	}
	selection := GCSelection{Current: request.Current, IncludeKept: request.IncludeKept}
	if request.UseHaven {
		selection.Registered = request.registeredSlugs(ctx)
	}
	plan := SelectGarbage(states, selection)
	if len(plan.Runs)+len(plan.OrphanSlugs) == 0 {
		fmt.Fprintln(request.Out, "gc: nothing stale")
		return nil
	}
	var problems []string
	for _, stale := range plan.Runs {
		problems = append(problems, request.collectRun(ctx, stale)...)
	}
	for _, slug := range plan.OrphanSlugs {
		fmt.Fprintf(request.Out, "gc: orphan stack %s: haven destroy\n", slug)
		problems = append(problems, request.destroy(ctx, slug)...)
	}
	if err := request.Run(ctx, commandSpec{name: "git", args: []string{"worktree", "prune"}, dir: request.Root}, request.Out); err != nil {
		problems = append(problems, fmt.Sprintf("git worktree prune: %v", err))
	}
	if len(problems) > 0 {
		return fmt.Errorf("gc: %s", strings.Join(problems, "; "))
	}
	return nil
}

func (request GCRequest) filled() GCRequest {
	if request.Run == nil {
		request.Run = execRunner
	}
	if request.Environ == nil {
		request.Environ = os.Environ
	}
	if request.Alive == nil {
		request.Alive = ProcessAlive
	}
	if request.Out == nil {
		request.Out = io.Discard
	}
	return request
}

func (request GCRequest) collectRun(ctx context.Context, stale GCRun) []string {
	var problems []string
	action := "worktrees and stacks only, report kept"
	if stale.RemoveDir {
		action = "whole directory"
	}
	fmt.Fprintf(request.Out, "gc: stale run %s: removing %s\n", stale.State.Name, action)
	if request.UseHaven {
		for _, slug := range stale.State.Slugs() {
			problems = append(problems, request.destroy(ctx, slug)...)
		}
	}
	problems = append(problems, request.removeWorktrees(ctx, stale.State.Worktrees)...)
	if stale.RemoveDir {
		if err := os.RemoveAll(stale.State.Dir); err != nil {
			problems = append(problems, fmt.Sprintf("remove %s: %v", stale.State.Dir, err))
		}
	}
	return problems
}

func (request GCRequest) removeWorktrees(ctx context.Context, dirs []string) []string {
	var problems []string
	for _, dir := range dirs {
		fmt.Fprintf(request.Out, "gc:   git worktree remove %s\n", dir)
		remove := WorktreeRemoveCommand(dir)
		remove.dir = request.Root
		if err := request.Run(ctx, remove, request.Out); err != nil {
			fmt.Fprintf(request.Out, "gc:   not a worktree any more, deleting %s\n", dir)
		}
		if err := os.RemoveAll(dir); err != nil {
			problems = append(problems, fmt.Sprintf("remove %s: %v", dir, err))
		}
	}
	return problems
}

// destroy tears down one stack. A slug haven does not know is not a problem:
// most stale runs' stacks are already gone.
func (request GCRequest) destroy(ctx context.Context, slug string) []string {
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: havenrun.DestroyArgs(slug), dir: request.Root, env: havenEnv(request.Environ(), slug)}
	if err := request.Run(ctx, spec, &out); err != nil && !strings.Contains(strings.ToLower(out.String()), "no such") &&
		!strings.Contains(strings.ToLower(out.String()), "not found") {
		return []string{fmt.Sprintf("haven destroy %s: %v", slug, err)}
	}
	return nil
}

func (request GCRequest) registeredSlugs(ctx context.Context) []string {
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: havenrun.StatusArgs(), dir: request.Root, env: request.Environ()}
	if err := request.Run(ctx, spec, &out); err != nil {
		fmt.Fprintf(request.Out, "gc: haven status failed, orphan stacks not checked: %v\n", err)
		return nil
	}
	status, err := havenrun.ParseStatus(out.Bytes())
	if err != nil {
		fmt.Fprintf(request.Out, "gc: haven status unreadable, orphan stacks not checked: %v\n", err)
		return nil
	}
	slugs := make([]string, 0, len(status.Stacks))
	for _, stack := range status.Stacks {
		slugs = append(slugs, stack.Slug)
	}
	return slugs
}
