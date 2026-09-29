package visualdiff

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// LoopDirName is the fix loop's one run directory (README "The fix loop"):
// `visualdiff flow` and `visualdiff route` keep its candidate stack up
// between calls, and `visualdiff down` stops it. It is not named as a run
// time, so a run's gc never removes it.
const LoopDirName = "loop"

// LoopDir is where the fix loop keeps its run.
func LoopDir(root string) string { return filepath.Join(root, ".visualdiff", LoopDirName) }

// loopFlags is one parsed `visualdiff flow|route` command line.
type loopFlags struct {
	root         string
	section      string
	edition      Edition
	candidateRef string
	force        bool
	devUI        bool
	dryRun       bool
}

// LoopOptions are a fix-loop call's run options: kept, resumed once the loop
// directory is kept, following the candidate's commit, against main's pin.
func LoopOptions(flags loopFlags, config *Config) Options {
	dir := LoopDir(flags.root)
	viewport := configuredViewport(config, Viewport{Width: 1440, Height: 900})
	return Options{
		Root: flags.root, BaseRef: "origin/main", CandidateRef: flags.candidateRef, RunDir: dir,
		Viewport: viewport, Keep: true, Resume: exists(filepath.Join(dir, RunKeepFile)), Follow: true,
		UseHaven: true, Editions: []Edition{flags.edition}, Baseline: true, PinMain: true, NoPublish: true,
		Force: flags.force, DevUI: flags.devUI, DryRun: flags.dryRun,
	}
}

// loopCommand is `visualdiff flow <id>` and `visualdiff route <path>`: one
// section against main's cached baseline on the loop's kept candidate stack.
func loopCommand(ctx context.Context, kind string, args []string, streams Streams) int {
	parsed, err := parseLoopFlags(kind, args, streams.Err)
	if err == nil && !havenOnPath() {
		err = errors.New(kind + ": the fix loop keeps a haven stack up, and haven is not installed")
	}
	var config *Config
	if err == nil {
		config, err = loopConfig(kind, parsed)
	}
	if err != nil {
		if !errors.Is(err, errFlagsReported) {
			fmt.Fprintln(streams.Err, "visualdiff:", err)
		}
		return ExitOperational
	}
	options := LoopOptions(*parsed, config)
	result, err := Execute(ctx, Request{Options: options, Config: config}, Streams{Out: streams.Err, Err: streams.Err})
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	if !options.DryRun {
		fmt.Fprint(streams.Out, LoopVerdict(result.Rows, filepath.Join(options.RunDir, VerdictFile)))
	}
	return ExitCode(result, nil)
}

// loopConfig is visualdiff.yaml narrowed to the one section named.
func loopConfig(kind string, parsed *loopFlags) (*Config, error) {
	config, err := LoadConfig(filepath.Join(parsed.root, ConfigFile))
	if err != nil {
		return nil, err
	}
	if kind == "flow" {
		return config.Select(nil, []string{parsed.section})
	}
	return config.Select([]string{parsed.section}, nil)
}

// parseLoopFlags takes the section first or after the flags.
func parseLoopFlags(kind string, args []string, stderr io.Writer) (*loopFlags, error) {
	flags := flag.NewFlagSet(kind, flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", ".", "repository root")
	edition := flags.String("edition", string(EditionEnterprise), "edition to capture: enterprise or free")
	candidateRef := flags.String("candidate", "HEAD", "ref under test; the loop's worktree follows it")
	force := flags.Bool("force", false, "run on battery, under load or beside another visualdiff stack")
	devUI := flags.Bool("dev-ui", false, "capture from the Vite dev server instead of a production build")
	dryRun := flags.Bool("dry-run", false, "print the plan and start nothing")
	section := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		section, args = args[0], args[1:]
	}
	if err := flags.Parse(args); err != nil {
		return nil, errFlagsReported
	}
	if section == "" {
		section = flags.Arg(0)
	}
	if section == "" {
		return nil, fmt.Errorf("%s: name the %s to run, as visualdiff.yaml has it", kind, kind)
	}
	editions, err := ParseEditions(*edition)
	if err != nil || len(editions) != 1 {
		return nil, fmt.Errorf("%s: -edition wants exactly one of enterprise or free", kind)
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		return nil, err
	}
	return &loopFlags{
		root: absoluteRoot, section: section, edition: editions[0], candidateRef: *candidateRef,
		force: *force, devUI: *devUI, dryRun: *dryRun,
	}, nil
}

// LoopVerdict is a fix-loop call's answer: a line per flow verdict or route,
// the first failure under it, and where verdict.md is.
func LoopVerdict(rows []Row, verdictPath string) string {
	var out strings.Builder
	for _, verdict := range JudgeFlows(rows) {
		fmt.Fprintf(&out, "flow %s [%s]: %s", verdict.Flow, verdict.Edition, verdict.Verdict)
		if len(verdict.Proof) > 0 {
			fmt.Fprintf(&out, " (%d expects held)", len(verdict.Proof))
		}
		out.WriteString("\n")
		if verdict.FirstFailure != "" {
			fmt.Fprintf(&out, "  first failure: %s\n", verdict.FirstFailure)
		}
	}
	for index := range rows {
		row := rows[index]
		if row.Kind != "route" {
			continue
		}
		if !row.Finding() {
			fmt.Fprintf(&out, "route %s [%s]: no finding (%s)\n", row.Key, row.Edition, row.Class)
			continue
		}
		fmt.Fprintf(&out, "route %s [%s]: %s · %s\n", row.Key, row.Edition, row.Class, head(row.Why))
	}
	fmt.Fprintf(&out, "verdict: %s\n", verdictPath)
	return out.String()
}

// downCommand is `visualdiff down`: the loop's stacks, worktrees and directory go.
func downCommand(ctx context.Context, args []string, streams Streams) int {
	flags := flag.NewFlagSet("down", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	root := flags.String("root", ".", "repository root")
	if err := flags.Parse(args); err != nil {
		return ExitOperational
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err == nil {
		err = StopLoop(ctx, GCRequest{Root: absoluteRoot, UseHaven: havenOnPath(), Out: streams.Err})
	}
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	return ExitClean
}

// StopLoop un-keeps the loop's run so gc takes its stacks and worktrees, then
// removes its directory, seed marker included, so the next call starts fresh.
func StopLoop(ctx context.Context, request GCRequest) error {
	dir := LoopDir(request.Root)
	if !dirExists(dir) {
		fmt.Fprintln(request.Out, "down: no fix-loop stack")
		return nil
	}
	if readRunState(dir, ProcessAlive).Alive {
		return errors.New("down: a fix-loop call is still running; stop it first")
	}
	if err := os.Remove(filepath.Join(dir, RunKeepFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	gcErr := CollectGarbage(ctx, request)
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	fmt.Fprintln(request.Out, "down: the fix loop's stacks are stopped")
	return gcErr
}
